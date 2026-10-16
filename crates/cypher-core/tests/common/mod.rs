//! Lokaler Test-HTTP-Server (kein Internet in Unit-Tests). Bietet Dateien mit Range/ETag, Fehlerfälle,
//! Weiterleitungen und langsame Antworten.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use cypher_core::download::{HostRule, HttpClient, RedirectPolicy};
use futures_util::stream;

#[derive(Debug, Clone, Default)]
pub struct Recorded {
    pub path: String,
    pub range: Option<String>,
    pub if_range: Option<String>,
    pub user_agent: Option<String>,
}

/// Verhalten des Servers für `/file`.
pub struct Behavior {
    pub data: Vec<u8>,
    pub etag: &'static str,
    pub support_range: bool,
    /// So viele Anfragen zuerst mit diesem Status beantworten (z. B. 500 oder 429).
    pub fail_first: AtomicU32,
    pub fail_status: u16,
    pub retry_after: Option<&'static str>,
    /// Erste Antwort bricht nach so vielen Bytes mitten im Body ab.
    pub cut_first_at: Mutex<Option<usize>>,
    /// Antwort tröpfelt: Chunk-Größe und Pause.
    pub trickle: Mutex<Option<(usize, Duration)>>,
    /// So viele Bereichsanfragen mit 416 beantworten.
    pub force_416: AtomicU32,
    /// Antwort ohne Content-Length (Chunked).
    pub chunked: bool,
    /// Content-Length lügt (für Größenprüfung): Server schickt mehr Daten als angekündigt.
    pub extra_bytes: usize,
    pub requests: Mutex<Vec<Recorded>>,
    /// Statische Dateien unter `/files/<pfad>` (Katalog, Prüfsummen, Signaturen).
    pub files: Mutex<std::collections::HashMap<String, Vec<u8>>>,
}

impl Behavior {
    pub fn new(data: Vec<u8>) -> Self {
        Behavior {
            data,
            etag: "\"v1\"",
            support_range: true,
            fail_first: AtomicU32::new(0),
            fail_status: 500,
            retry_after: None,
            cut_first_at: Mutex::new(None),
            trickle: Mutex::new(None),
            force_416: AtomicU32::new(0),
            chunked: false,
            extra_bytes: 0,
            requests: Mutex::new(Vec::new()),
            files: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn recorded(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

fn header_string(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned)
}

async fn file(State(b): State<Arc<Behavior>>, headers: HeaderMap) -> Response {
    b.requests.lock().unwrap().push(Recorded {
        path: "/file".into(),
        range: header_string(&headers, header::RANGE),
        if_range: header_string(&headers, header::IF_RANGE),
        user_agent: header_string(&headers, header::USER_AGENT),
    });
    if b.fail_first.load(Ordering::SeqCst) > 0 {
        b.fail_first.fetch_sub(1, Ordering::SeqCst);
        let mut resp = Response::builder().status(b.fail_status);
        if let Some(ra) = b.retry_after {
            resp = resp.header(header::RETRY_AFTER, ra);
        }
        return resp.body(Body::from("fehler")).unwrap();
    }

    let total = b.data.len();
    let mut start = 0usize;
    let mut status = StatusCode::OK;
    let mut content_range = None;
    if b.support_range
        && let Some(range) = header_string(&headers, header::RANGE)
        && let Some(rest) = range.strip_prefix("bytes=")
        && let Some((from, _)) = rest.split_once('-')
        && let Ok(from) = from.parse::<usize>()
    {
        if b.force_416.load(Ordering::SeqCst) > 0 {
            b.force_416.fetch_sub(1, Ordering::SeqCst);
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Body::empty())
                .unwrap();
        }
        let if_range_ok = header_string(&headers, header::IF_RANGE).is_none_or(|v| v == b.etag);
        if from >= total {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Body::empty())
                .unwrap();
        }
        if if_range_ok {
            start = from;
            status = StatusCode::PARTIAL_CONTENT;
            content_range = Some(format!("bytes {start}-{}/{total}", total - 1));
        }
    }

    let mut payload = b.data[start..].to_vec();
    let announced = payload.len();
    payload.extend(std::iter::repeat_n(b'!', b.extra_bytes));
    let cut = b.cut_first_at.lock().unwrap().take();

    let mut builder =
        Response::builder().status(status).header(header::ETAG, b.etag).header(header::ACCEPT_RANGES, "bytes");
    if !b.chunked {
        builder = builder.header(header::CONTENT_LENGTH, announced.to_string());
    }
    if let Some(cr) = content_range {
        builder = builder.header(header::CONTENT_RANGE, cr);
    }

    let body = if let Some(cut) = cut {
        let first = Bytes::from(payload[..cut.min(payload.len())].to_vec());
        // Erst den Anfang liefern und ihm Zeit zum Ausliefern geben, dann die Verbindung abreißen lassen.
        Body::from_stream(stream::unfold(Some(first), |state| async move {
            match state {
                Some(first) => Some((Ok::<Bytes, std::io::Error>(first), None)),
                None => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    Some((Err(std::io::Error::other("Verbindung getrennt")), None))
                }
            }
        }))
    } else if let Some((chunk, pause)) = *b.trickle.lock().unwrap() {
        let chunks: Vec<Bytes> = payload.chunks(chunk).map(|c| Bytes::from(c.to_vec())).collect();
        Body::from_stream(stream::unfold(chunks.into_iter(), move |mut it| async move {
            let next = it.next()?;
            tokio::time::sleep(pause).await;
            Some((Ok::<_, std::io::Error>(next), it))
        }))
    } else if b.chunked {
        let parts: Vec<Result<Bytes, std::io::Error>> =
            payload.chunks(payload.len().div_ceil(3).max(1)).map(|c| Ok(Bytes::from(c.to_vec()))).collect();
        Body::from_stream(stream::iter(parts))
    } else {
        Body::from(payload)
    };
    builder.body(body).unwrap()
}

async fn redirect_to_file() -> Response {
    Response::builder().status(302).header(header::LOCATION, "/file").body(Body::empty()).unwrap()
}

async fn redirect_to_localhost(State(b): State<Arc<Behavior>>, headers: HeaderMap) -> Response {
    let host = header_string(&headers, header::HOST).unwrap_or_default();
    let port = host.rsplit(':').next().unwrap_or("80").to_owned();
    let _ = &b;
    Response::builder()
        .status(302)
        .header(header::LOCATION, format!("http://localhost:{port}/file"))
        .body(Body::empty())
        .unwrap()
}

async fn redirect_loop() -> Response {
    Response::builder().status(302).header(header::LOCATION, "/loop").body(Body::empty()).unwrap()
}

async fn static_file(
    State(b): State<Arc<Behavior>>,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> Response {
    b.requests.lock().unwrap().push(Recorded { path: format!("/files/{path}"), ..Recorded::default() });
    match b.files.lock().unwrap().get(&path) {
        Some(bytes) => Response::builder().status(200).body(Body::from(bytes.clone())).unwrap(),
        None => (StatusCode::NOT_FOUND, "nicht da").into_response(),
    }
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "nicht da").into_response()
}

async fn small(State(b): State<Arc<Behavior>>) -> Response {
    Response::builder()
        .status(200)
        .header(header::CONTENT_LENGTH, b.data.len().to_string())
        .body(Body::from(b.data.clone()))
        .unwrap()
}

pub struct TestServer {
    pub addr: SocketAddr,
    pub behavior: Arc<Behavior>,
    _handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    pub async fn start(behavior: Behavior) -> TestServer {
        let behavior = Arc::new(behavior);
        let app = Router::new()
            .route("/file", get(file))
            .route("/small", get(small))
            .route("/redir-ok", get(redirect_to_file))
            .route("/redir-bad", get(redirect_to_localhost))
            .route("/loop", get(redirect_loop))
            .route("/missing", get(not_found))
            .route("/files/{*path}", get(static_file))
            .with_state(behavior.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        TestServer { addr, behavior, _handle: handle }
    }

    pub fn put_file(&self, path: &str, bytes: impl Into<Vec<u8>>) {
        self.behavior.files.lock().unwrap().insert(path.to_owned(), bytes.into());
    }

    pub fn url(&self, path: &str) -> url::Url {
        url::Url::parse(&format!("http://{}{path}", self.addr)).unwrap()
    }
}

/// Client, der nur 127.0.0.1 kennt.
pub fn client() -> HttpClient {
    HttpClient::for_test(&[HostRule { host: "127.0.0.1", redirects: RedirectPolicy::WithinAllowlist }]).unwrap()
}

/// Reproduzierbare Testdaten.
pub fn test_data(len: usize) -> Vec<u8> {
    (0..len).map(|i| ((i * 31 + 7) % 251) as u8).collect()
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    cypher_core::verify::sha256_bytes(data)
}

pub fn header_value(s: &str) -> HeaderValue {
    HeaderValue::from_str(s).unwrap()
}
