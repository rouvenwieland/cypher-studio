//! Eigene Protokolle `cyfile`, `cythumb`, `cyasset` (ARCHITEKTUR.md 6.3).
//!
//! Die Entscheidung, was ausgeliefert wird, trifft `cypher_core::app::serve`; hier stehen nur Anfrage-Zerlegung und
//! Kopfzeilen. Unbekanntes und Abgelehntes wird ohne Details zu 404.

use std::sync::Arc;

use cypher_core::app::App;
use cypher_core::app::serve::{CachePolicy, Served};
use cypher_core::urls::decode_request_path;
use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::ctx::AppCtx;

pub const CYFILE: &str = "cyfile";
pub const CYTHUMB: &str = "cythumb";
pub const CYASSET: &str = "cyasset";

/// Herkunft der App-Oberfläche. Ohne `Access-Control-Allow-Origin` wäre die Leinwand „tainted“ und `convertToBlob` scheiterte.
fn app_origin(request: &Request<Vec<u8>>) -> String {
    let default = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    let allowed: &[&str] = &[
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        #[cfg(debug_assertions)]
        "http://localhost:1420",
    ];
    request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .filter(|origin| allowed.contains(origin))
        .unwrap_or(default)
        .to_owned()
}

fn builder(status: StatusCode, origin: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::VARY, "Origin")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
}

fn not_found(origin: &str) -> Response<Vec<u8>> {
    builder(StatusCode::NOT_FOUND, origin)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_default()
}

fn served(content: Served, origin: &str, head: bool) -> Response<Vec<u8>> {
    let cache = match content.cache {
        CachePolicy::NoStore => "no-store".to_owned(),
        CachePolicy::MaxAge(secs) => format!("max-age={secs}"),
    };
    let length = content.body.len();
    builder(StatusCode::OK, origin)
        .header(header::CONTENT_TYPE, content.mime)
        .header(header::CONTENT_LENGTH, length)
        .header(header::CACHE_CONTROL, cache)
        .body(if head { Vec::new() } else { content.body })
        .unwrap_or_default()
}

/// Antwort auf eine Anfrage an `scheme`.
pub async fn respond(app: Arc<App>, scheme: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = app_origin(request);
    let head = request.method() == Method::HEAD;
    if request.method() != Method::GET && !head {
        return not_found(&origin);
    }
    let Some(path) = decode_request_path(request.uri().path()) else { return not_found(&origin) };
    let content = match scheme {
        CYFILE => app.serve_file(&path).await,
        CYTHUMB => app.serve_thumbnail(&path).await,
        CYASSET => app.serve_asset(&path).await,
        _ => None,
    };
    match content {
        Some(content) => served(content, &origin, head),
        None => not_found(&origin),
    }
}

/// Handler für `register_asynchronous_uri_scheme_protocol`.
pub fn handler<R: Runtime>(
    scheme: &'static str,
) -> impl Fn(UriSchemeContext<'_, R>, Request<Vec<u8>>, UriSchemeResponder) + Send + Sync + 'static {
    move |ctx, request, responder| {
        let Some(state) = ctx.app_handle().try_state::<AppCtx>() else {
            responder.respond(not_found(&app_origin(&request)));
            return;
        };
        let app = state.app.clone();
        tauri::async_runtime::spawn(async move {
            let response = respond(app, scheme, &request).await;
            responder.respond(response);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: Method, uri: &str, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(o) = origin {
            b = b.header(header::ORIGIN, o);
        }
        b.body(Vec::new()).unwrap()
    }

    #[test]
    fn only_the_apps_own_origins_are_echoed() {
        let own = request(Method::GET, "cyfile://localhost/x", Some("tauri://localhost"));
        assert_eq!(app_origin(&own), "tauri://localhost");
        let foreign = request(Method::GET, "cyfile://localhost/x", Some("https://boese.example"));
        assert_ne!(app_origin(&foreign), "https://boese.example");
        let none = request(Method::GET, "cyfile://localhost/x", None);
        assert!(app_origin(&none).contains("tauri"));
    }

    #[test]
    fn answers_carry_nosniff_cors_and_the_cache_rule() {
        let ok = served(
            Served { mime: "image/png".into(), body: vec![1, 2, 3], cache: CachePolicy::MaxAge(86_400) },
            "tauri://localhost",
            false,
        );
        let h = ok.headers();
        assert_eq!(h[header::CONTENT_TYPE], "image/png");
        assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(h[header::ACCESS_CONTROL_ALLOW_ORIGIN], "tauri://localhost");
        assert_eq!(h[header::CACHE_CONTROL], "max-age=86400");
        assert_eq!(ok.body(), &vec![1, 2, 3]);

        let head =
            served(Served { mime: "image/png".into(), body: vec![1, 2, 3], cache: CachePolicy::NoStore }, "o", true);
        assert_eq!(head.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(head.headers()[header::CONTENT_LENGTH], "3");
        assert!(head.body().is_empty());

        let missing = not_found("tauri://localhost");
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert!(missing.body().is_empty(), "keine Details im 404");
    }
}
