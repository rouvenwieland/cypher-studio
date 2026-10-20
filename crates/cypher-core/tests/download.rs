//! Download gegen einen lokalen Test-Server: Fortsetzen, Wiederholen, Abbruch, Hostliste, Prüfsummen.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

use common::*;
use cypher_core::api::NetworkPurpose;
use cypher_core::download::{DownloadProgress, DownloadRequest, HostPolicy, HttpClient, fetch_small, fetch_to_file};
use cypher_core::error::{DownloadError, VerifyError};
use cypher_core::progress::Collect;
use tokio_util::sync::CancellationToken;

fn request(server: &TestServer, dir: &Path, data: &[u8]) -> DownloadRequest {
    let mut req = DownloadRequest::new(
        server.url("/file"),
        dir.join("downloads/abc.part"),
        dir.join("downloads/abc.zip"),
        "abc.zip",
        data.len() as u64,
        sha256(data),
    );
    req.retry_delays = vec![Duration::from_millis(10); 3];
    req
}

fn write_meta(part: &Path, req: &DownloadRequest, etag: &str) {
    let meta = serde_json::json!({
        "url": req.url.to_string(), "etag": etag, "lastModified": null, "expectedSize": req.expected_size
    });
    std::fs::create_dir_all(part.parent().unwrap()).unwrap();
    std::fs::write(format!("{}.json", part.display()), serde_json::to_vec(&meta).unwrap()).unwrap();
}

#[tokio::test]
async fn downloads_verifies_and_reports_progress() {
    let data = test_data(300_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data);
    let sink = Collect::new();
    let file = fetch_to_file(&client(), &req, &sink, &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    assert_eq!(file.sha256, sha256(&data));
    assert!(!req.part_path.exists(), "die .part-Datei muss nach dem Erfolg weg sein");
    assert!(!dir.path().join("downloads/abc.part.json").exists());
    let events = sink.take();
    assert_eq!(events.first(), Some(&DownloadProgress::Started { total: 300_000 }));
    assert!(matches!(events.last(), Some(DownloadProgress::Progress { done: 300_000, total: 300_000, .. })));
    assert_eq!(server.behavior.recorded()[0].user_agent.as_deref(), Some("CypherStudio/test"));
}

#[tokio::test]
async fn resumes_with_range_and_if_range() {
    let data = test_data(300_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data);
    std::fs::create_dir_all(req.part_path.parent().unwrap()).unwrap();
    std::fs::write(&req.part_path, &data[..100_000]).unwrap();
    write_meta(&req.part_path, &req, "\"v1\"");

    let sink = Collect::new();
    let file = fetch_to_file(&client(), &req, &sink, &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    let rec = server.behavior.recorded();
    assert_eq!(rec.len(), 1);
    assert_eq!(rec[0].range.as_deref(), Some("bytes=100000-"));
    assert_eq!(rec[0].if_range.as_deref(), Some("\"v1\""));
    assert!(sink.take().contains(&DownloadProgress::Resumed { from: 100_000 }));
}

#[tokio::test]
async fn changed_validator_restarts_from_zero() {
    let data = test_data(200_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data);
    std::fs::create_dir_all(req.part_path.parent().unwrap()).unwrap();
    std::fs::write(&req.part_path, vec![0xAAu8; 50_000]).unwrap(); // Datei einer älteren Version
    write_meta(&req.part_path, &req, "\"alt\"");

    let sink = Collect::new();
    let file = fetch_to_file(&client(), &req, &sink, &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    assert_eq!(server.behavior.recorded()[0].if_range.as_deref(), Some("\"alt\""));
    assert!(
        !sink.take().iter().any(|e| matches!(e, DownloadProgress::Resumed { .. })),
        "kein Fortsetzen bei neuem ETag"
    );
}

#[tokio::test]
async fn range_not_satisfiable_discards_the_part_and_starts_over() {
    let data = test_data(120_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    server.behavior.force_416.store(1, Ordering::SeqCst);
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data);
    std::fs::create_dir_all(req.part_path.parent().unwrap()).unwrap();
    std::fs::write(&req.part_path, &data[..40_000]).unwrap();
    write_meta(&req.part_path, &req, "\"v1\"");

    let file = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    let rec = server.behavior.recorded();
    assert_eq!(rec.len(), 2);
    assert!(rec[0].range.is_some());
    assert!(rec[1].range.is_none(), "nach 416 von vorn, ohne Range");
}

#[tokio::test]
async fn complete_part_is_verified_without_network() {
    let data = test_data(80_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data);
    std::fs::create_dir_all(req.part_path.parent().unwrap()).unwrap();
    std::fs::write(&req.part_path, &data).unwrap();
    write_meta(&req.part_path, &req, "\"v1\"");
    let file = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    assert!(server.behavior.recorded().is_empty());
}

#[tokio::test]
async fn retries_server_errors_and_reports_them() {
    let data = test_data(50_000);
    let mut b = Behavior::new(data.clone());
    b.fail_status = 500;
    let server = TestServer::start(b).await;
    server.behavior.fail_first.store(2, Ordering::SeqCst);
    let dir = tempfile::tempdir().unwrap();
    let sink = Collect::new();
    let file =
        fetch_to_file(&client(), &request(&server, dir.path(), &data), &sink, &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    assert_eq!(server.behavior.recorded().len(), 3);
    let retries: Vec<_> = sink.take().into_iter().filter(|e| matches!(e, DownloadProgress::Retrying { .. })).collect();
    assert_eq!(retries.len(), 2);
    assert!(matches!(&retries[0], DownloadProgress::Retrying { attempt: 2, max: 4, .. }));
}

#[tokio::test]
async fn honours_retry_after_on_429() {
    let data = test_data(10_000);
    let mut b = Behavior::new(data.clone());
    b.fail_status = 429;
    b.retry_after = Some("1");
    let server = TestServer::start(b).await;
    server.behavior.fail_first.store(1, Ordering::SeqCst);
    let dir = tempfile::tempdir().unwrap();
    let sink = Collect::new();
    let started = std::time::Instant::now();
    fetch_to_file(&client(), &request(&server, dir.path(), &data), &sink, &CancellationToken::new()).await.unwrap();
    assert!(started.elapsed() >= Duration::from_millis(900), "Retry-After muss beachtet werden");
    assert!(sink.take().iter().any(|e| matches!(e, DownloadProgress::Retrying { delay_ms: 1000, .. })));
}

#[tokio::test]
async fn gives_up_after_the_maximum_number_of_attempts() {
    let data = test_data(10_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    server.behavior.fail_first.store(100, Ordering::SeqCst);
    let dir = tempfile::tempdir().unwrap();
    let err =
        fetch_to_file(&client(), &request(&server, dir.path(), &data), &Collect::new(), &CancellationToken::new())
            .await
            .unwrap_err();
    assert!(matches!(err, DownloadError::Http { status: 500, .. }), "{err}");
    assert_eq!(server.behavior.recorded().len(), 4);
}

#[tokio::test]
async fn does_not_retry_client_errors() {
    let data = test_data(10_000);
    let mut b = Behavior::new(data.clone());
    b.fail_status = 404;
    let server = TestServer::start(b).await;
    server.behavior.fail_first.store(100, Ordering::SeqCst);
    let dir = tempfile::tempdir().unwrap();
    let err =
        fetch_to_file(&client(), &request(&server, dir.path(), &data), &Collect::new(), &CancellationToken::new())
            .await
            .unwrap_err();
    assert!(matches!(err, DownloadError::Http { status: 404, .. }), "{err}");
    assert_eq!(server.behavior.recorded().len(), 1);
}

#[tokio::test]
async fn cancel_keeps_the_part_and_a_later_download_continues() {
    let data = test_data(200_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    *server.behavior.trickle.lock().unwrap() = Some((4_000, Duration::from_millis(20)));
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data);
    let cancel = CancellationToken::new();
    // Abbruch nach dem ersten geschriebenen Block statt nach fester Wanduhrzeit (zeitunabhängig)
    let c2 = cancel.clone();
    let cancel_after_first_bytes = move |e: DownloadProgress| {
        if matches!(e, DownloadProgress::Progress { done, .. } if done > 0) {
            c2.cancel();
        }
    };
    let err = fetch_to_file(&client(), &req, &cancel_after_first_bytes, &cancel).await.unwrap_err();
    assert!(matches!(err, DownloadError::Cancelled), "{err}");
    let partial = std::fs::metadata(&req.part_path).unwrap().len();
    assert!(partial > 0 && partial < 200_000, "{partial}");
    assert!(!req.final_path.exists());

    *server.behavior.trickle.lock().unwrap() = None;
    let sink = Collect::new();
    let file = fetch_to_file(&client(), &req, &sink, &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    assert!(sink.take().iter().any(|e| matches!(e, DownloadProgress::Resumed { .. })), "Fortsetzen nach Abbruch");
}

#[tokio::test]
async fn dropped_connection_resumes_where_it_stopped() {
    let data = test_data(260_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    *server.behavior.cut_first_at.lock().unwrap() = Some(100_000);
    let dir = tempfile::tempdir().unwrap();
    let sink = Collect::new();
    let file =
        fetch_to_file(&client(), &request(&server, dir.path(), &data), &sink, &CancellationToken::new()).await.unwrap();
    assert_eq!(std::fs::read(&file.path).unwrap(), data);
    let rec = server.behavior.recorded();
    assert_eq!(rec.len(), 2);
    let second = rec[1].range.clone().unwrap();
    assert!(second.starts_with("bytes=") && second.ends_with('-'), "{second}");
    let events = sink.take();
    assert!(events.iter().any(|e| matches!(e, DownloadProgress::Retrying { .. })));
    assert!(events.iter().any(|e| matches!(e, DownloadProgress::Resumed { .. })));
}

#[tokio::test]
async fn wrong_announced_size_is_rejected_before_downloading() {
    let data = test_data(50_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let mut req = request(&server, dir.path(), &data);
    req.expected_size = 40_000; // der Katalog behauptet weniger, als der Server liefert
    let err = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(err, DownloadError::SizeMismatch { expected: 40_000, actual: 50_000, .. }), "{err}");
    assert!(!req.part_path.exists());
}

#[tokio::test]
async fn too_many_bytes_without_content_length_abort_and_delete_the_part() {
    let data = test_data(50_000);
    let mut b = Behavior::new(data.clone());
    b.chunked = true;
    let server = TestServer::start(b).await;
    let dir = tempfile::tempdir().unwrap();
    let mut req = request(&server, dir.path(), &data);
    req.expected_size = 30_000;
    let err = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(err, DownloadError::SizeMismatch { expected: 30_000, .. }), "{err}");
    assert!(!req.part_path.exists() && !req.final_path.exists());
}

#[tokio::test]
async fn manipulated_content_is_rejected_and_nothing_remains() {
    let data = test_data(120_000);
    let mut tampered = data.clone();
    tampered[60_000] ^= 0xFF; // gleiche Größe, ein Byte anders
    let server = TestServer::start(Behavior::new(tampered)).await;
    let dir = tempfile::tempdir().unwrap();
    let req = request(&server, dir.path(), &data); // erwartet die Prüfsumme der echten Daten
    let err = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    match err {
        DownloadError::Checksum(VerifyError::ChecksumMismatch { file, expected, actual }) => {
            assert_eq!(file, "abc.zip");
            assert_ne!(expected, actual);
        }
        other => panic!("erwartet ChecksumMismatch, erhalten {other}"),
    }
    assert!(!req.part_path.exists(), ".part muss gelöscht sein (kein Fortsetzen auf Müll)");
    assert!(!dir.path().join("downloads/abc.part.json").exists());
    assert!(!req.final_path.exists());
}

#[tokio::test]
async fn same_host_redirects_are_followed_and_foreign_hosts_are_blocked() {
    let data = test_data(30_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let mut req = request(&server, dir.path(), &data);
    req.url = server.url("/redir-ok");
    fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap();

    let dir2 = tempfile::tempdir().unwrap();
    let mut req = request(&server, dir2.path(), &data);
    req.url = server.url("/redir-bad");
    let err = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(&err, DownloadError::InsecureUrl(u) if u.contains("localhost")), "{err}");

    // Endlosschleife von Weiterleitungen
    req.url = server.url("/loop");
    let err = fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err();
    assert!(matches!(err, DownloadError::Network { .. }), "{err}");
}

#[tokio::test]
async fn hosts_and_schemes_are_checked_before_any_request() {
    let data = test_data(1_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let mut req = request(&server, dir.path(), &data);

    req.url = url::Url::parse("https://evil.example/x.zip").unwrap();
    assert!(matches!(
        fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err(),
        DownloadError::HostNotAllowed(_)
    ));
    req.url = url::Url::parse("http://example.com/x.zip").unwrap();
    assert!(matches!(
        fetch_to_file(&client(), &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err(),
        DownloadError::InsecureUrl(_)
    ));
    // Mit der echten Liste ist selbst der Test-Server tabu
    let real = HttpClient::new(
        "test",
        std::sync::Arc::new(HostPolicy::embedded()),
        std::sync::Arc::new(cypher_core::download::NetLog::new(None)),
    )
    .unwrap();
    req.url = server.url("/file");
    assert!(matches!(
        fetch_to_file(&real, &req, &Collect::new(), &CancellationToken::new()).await.unwrap_err(),
        DownloadError::InsecureUrl(_)
    ));
    assert!(server.behavior.recorded().is_empty());
}

#[tokio::test]
async fn small_files_obey_limits_status_and_strict_redirects() {
    let server = TestServer::start(Behavior::new(vec![b'x'; 1_000])).await;
    let c = client();
    let cancel = CancellationToken::new();
    let ok = fetch_small(&c, &server.url("/small"), 2_000, NetworkPurpose::Catalog, &cancel).await.unwrap();
    assert_eq!(ok.len(), 1_000);
    assert!(matches!(
        fetch_small(&c, &server.url("/small"), 500, NetworkPurpose::Catalog, &cancel).await.unwrap_err(),
        DownloadError::TooLarge { limit: 500 }
    ));
    assert!(matches!(
        fetch_small(&c, &server.url("/missing"), 500, NetworkPurpose::Catalog, &cancel).await.unwrap_err(),
        DownloadError::Http { status: 404, .. }
    ));
    assert!(matches!(
        fetch_small(&c, &server.url("/redir-bad"), 500, NetworkPurpose::Catalog, &cancel).await.unwrap_err(),
        DownloadError::InsecureUrl(_)
    ));
}

#[tokio::test]
async fn requests_are_logged_without_contents() {
    let data = test_data(5_000);
    let server = TestServer::start(Behavior::new(data.clone())).await;
    let dir = tempfile::tempdir().unwrap();
    let c = client();
    fetch_to_file(&c, &request(&server, dir.path(), &data), &Collect::new(), &CancellationToken::new()).await.unwrap();
    let recent = c.log().recent();
    assert!(!recent.is_empty());
    assert!(recent.iter().all(|r| r.host == "127.0.0.1"));
    assert!(recent.iter().any(|r| r.purpose == NetworkPurpose::ProgramDownload && r.status == Some(200)));
    let serialized = serde_json::to_string(&recent).unwrap();
    assert!(!serialized.contains("/file"), "keine Pfade oder Inhalte im Protokoll");
}
