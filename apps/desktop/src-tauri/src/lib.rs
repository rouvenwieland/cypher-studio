//! Cypher Studio – Tauri-Schicht: Plugins, Commands, Protokolle. Die Fachlogik liegt in `cypher-core`.

mod boot;
mod close_guard;
mod commands;
mod ctx;
mod dialogs;
mod dragdrop;
mod events;
mod logging;
mod protocols;
mod updater;

use tauri::Manager;

/// Registriert alle Commands und hält die Namensliste für den Vertragstest bereit.
/// Reihenfolge und Inhalt müssen `COMMAND_NAMES` + `RAW_COMMAND_NAMES` aus docs/ipc-contract.ts entsprechen.
macro_rules! register_commands {
    ($($module:ident :: $name:ident),* $(,)?) => {
        /// Namen aller registrierten Commands.
        pub const REGISTERED_COMMANDS: &[&str] = &[$(stringify!($name)),*];

        fn invoke_handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$(commands::$module::$name),*]
        }
    };
}

register_commands! {
        app::app_info,
        app::app_open_external,
        app::app_reveal,
        app::app_close,
        app::diagnostics_export,
        settings::settings_get,
        settings::settings_update,
        settings::settings_choose_dir,
        settings::network_info,
        catalog::catalog_status,
        catalog::catalog_refresh,
        programs::programs_list,
        programs::programs_rescan,
        programs::program_set_preferred,
        programs::program_add_manual,
        install::install_preview,
        install::install_start,
        install::installation_remove,
        launch::program_launch,
        setup::setup_packs_list,
        setup::setup_status,
        setup::setup_preview,
        setup::setup_apply,
        setup::setup_undo,
        setup::setup_history,
        files::file_pick,
        files::export_save_image,
        files::samples_list,
        projects::templates_list,
        projects::projects_list,
        projects::project_create,
        projects::project_new_file,
        projects::project_open_file,
        projects::project_open_last,
        projects::project_file_handle,
        projects::project_set_collection,
        projects::project_forget,
        projects::project_read_document,
        projects::project_write_document,
        projects::project_add_asset,
        library::library_status,
        library::library_choose_root,
        library::library_use_root,
        library::library_scan,
        library::library_query,
        library::library_get,
        library::library_update_meta,
        library::library_bulk_meta,
        library::library_import,
        library::library_entry_handle,
        library::library_set_collections,
        library::library_thumbnails_clear,
        library::library_pack_export,
        library::library_pack_inspect,
        library::library_pack_import,
        printcheck::print_profiles_list,
        printcheck::printcheck_analyze,
        printcheck::printcheck_export,
        printcheck::printcheck_overlay,
        brand::brand_get,
        brand::mockup_templates_list,
        brand::social_templates_list,
        updater::app_update_check,
        updater::app_update_install,
        jobs::jobs_active,
        jobs::jobs_recent,
        jobs::job_cancel,
        bgremove::bgremove_status,
        bgremove::bgremove_model_preview,
        bgremove::bgremove_model_install,
        bgremove::bgremove_run,
}

/// Startet die App.
pub fn run() -> tauri::Result<()> {
    let builder = tauri::Builder::default();

    // Desktop-Plugins. `single-instance` muss als erstes Plugin stehen.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // Zweiter Start: vorhandenes Fenster nach vorn holen.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    let builder = builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .register_asynchronous_uri_scheme_protocol(protocols::CYFILE, protocols::handler(protocols::CYFILE))
        .register_asynchronous_uri_scheme_protocol(protocols::CYTHUMB, protocols::handler(protocols::CYTHUMB))
        .register_asynchronous_uri_scheme_protocol(protocols::CYASSET, protocols::handler(protocols::CYASSET))
        .on_window_event(|window, event| {
            dragdrop::on_event(window, event);
            close_guard::on_event(window, event);
        })
        .setup(boot::setup)
        .invoke_handler(invoke_handler())
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use cypher_core::api::BuildChannel;
    use cypher_core::app::{App, AppConfig};
    use cypher_core::platform::AppDirs;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
    use tauri::webview::InvokeRequest;
    use tauri::{Listener, WebviewWindow};

    use super::*;

    fn root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    /// Alle Zeichenketten in einem Textabschnitt `"…"` (für die Namenslisten).
    fn quoted(text: &str) -> Vec<String> {
        text.split('"').skip(1).step_by(2).map(str::to_owned).collect()
    }

    fn contract_commands() -> Vec<String> {
        let text = fs::read_to_string(root().join("docs/ipc-contract.ts")).unwrap();
        let section = |name: &str| {
            let start = text.find(&format!("export const {name} = [")).unwrap();
            let rest = &text[start..];
            quoted(&rest[..rest.find("] as const").unwrap()])
        };
        let mut all = section("COMMAND_NAMES");
        all.extend(section("RAW_COMMAND_NAMES"));
        all
    }

    #[test]
    fn registered_commands_match_the_contract() {
        let registered: BTreeSet<String> = REGISTERED_COMMANDS.iter().map(|s| s.to_string()).collect();
        assert_eq!(registered.len(), REGISTERED_COMMANDS.len(), "ein Command ist doppelt registriert");
        let contract: BTreeSet<String> = contract_commands().into_iter().collect();
        assert_eq!(registered, contract, "registrierte Commands und docs/ipc-contract.ts weichen ab");
        assert_eq!(registered.len(), 71);
    }

    #[test]
    fn build_manifest_and_capability_cover_every_command() {
        let registered: BTreeSet<String> = REGISTERED_COMMANDS.iter().map(|s| s.to_string()).collect();

        // build.rs: Liste der AppManifest-Commands
        let build_rs = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("build.rs")).unwrap();
        let start = build_rs.find("const COMMANDS: &[&str] = &[").unwrap();
        let list = &build_rs[start..start + build_rs[start..].find("];").unwrap()];
        let in_build: BTreeSet<String> = quoted(list).into_iter().collect();
        assert_eq!(in_build, registered, "build.rs (AppManifest) und registrierte Commands weichen ab");

        // permissions/sets.toml: jede Freigabe `allow-<command>` steckt in genau einem Set
        let sets = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("permissions/sets.toml")).unwrap();
        for command in &registered {
            let permission = format!("\"allow-{}\"", command.replace('_', "-"));
            assert_eq!(
                sets.matches(&permission).count(),
                1,
                "{permission} muss in genau einem Set von sets.toml stehen"
            );
        }

        // capabilities/main.json: jedes Set ist freigegeben, sonst nichts außer den Event-Rechten
        let cap = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/main.json")).unwrap();
        let cap: serde_json::Value = serde_json::from_str(&cap).unwrap();
        let granted: BTreeSet<String> =
            cap["permissions"].as_array().unwrap().iter().map(|p| p.as_str().unwrap().to_owned()).collect();
        let set_ids: BTreeSet<String> = sets
            .lines()
            .filter_map(|l| l.strip_prefix("identifier = "))
            .map(|l| l.trim_matches('"').to_owned())
            .collect();
        let expected: BTreeSet<String> = set_ids
            .iter()
            .cloned()
            .chain(["core:event:allow-listen".to_owned(), "core:event:allow-unlisten".to_owned()])
            .collect();
        assert_eq!(granted, expected, "capabilities/main.json gibt nicht genau die Sets aus sets.toml frei");
        assert_eq!(cap["windows"], serde_json::json!(["main"]));
    }

    fn origin() -> &'static str {
        if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" }
    }

    fn request(cmd: &str, body: serde_json::Value) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: origin().parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    /// Eine Mock-App mit echtem Kern in einem Temp-Ordner und den echten Paketen.
    fn app() -> (tauri::App<MockRuntime>, tempfile::TempDir) {
        let tmp = tempfile::tempdir().unwrap();
        let app = mock_builder()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .invoke_handler(invoke_handler())
            .build(tauri::generate_context!())
            .unwrap();
        let dirs = AppDirs::with_root(tmp.path(), tmp.path().join("res"));
        let mut config = AppConfig::system(dirs, "0.1.0", BuildChannel::Dev).unwrap();
        config.packs_root = root().join("packs/dist");
        let core = App::new(config, events::event_sink(app.handle().clone())).unwrap();
        app.manage(ctx::AppCtx::new(core));
        (app, tmp)
    }

    fn main_window(app: &tauri::App<MockRuntime>) -> WebviewWindow<MockRuntime> {
        tauri::WebviewWindowBuilder::new(app, "main", Default::default()).build().unwrap()
    }

    fn call<T: serde::de::DeserializeOwned>(
        window: &WebviewWindow<MockRuntime>,
        cmd: &str,
        body: serde_json::Value,
    ) -> Result<T, serde_json::Value> {
        get_ipc_response(window, request(cmd, body)).map(|r| r.deserialize::<T>().unwrap())
    }

    #[test]
    fn commands_are_reachable_from_the_main_window_and_run_against_the_core() {
        let (app, _tmp) = app();
        let main = main_window(&app);
        let info: serde_json::Value = call(&main, "app_info", serde_json::json!({})).unwrap();
        assert_eq!(info["contractVersion"], cypher_core::api::names::IPC_CONTRACT_VERSION);
        assert_eq!(info["appVersion"], "0.1.0");

        let settings: serde_json::Value =
            call(&main, "settings_update", serde_json::json!({ "req": { "profile": { "displayName": "Rouven" } } }))
                .unwrap();
        assert_eq!(settings["profile"]["displayName"], "Rouven");
        let again: serde_json::Value = call(&main, "settings_get", serde_json::json!({})).unwrap();
        assert_eq!(again["profile"]["displayName"], "Rouven");

        let net: serde_json::Value = call(&main, "network_info", serde_json::json!({})).unwrap();
        assert_eq!(net["telemetry"], false);
        let view: serde_json::Value = call(&main, "programs_list", serde_json::json!({})).unwrap();
        assert!(view["programs"].as_array().unwrap().iter().any(|p| p["id"] == "blender"));
        let cancelled: bool =
            call(&main, "job_cancel", serde_json::json!({ "req": { "jobId": "gibtsnicht" } })).unwrap();
        assert!(!cancelled);
        let profiles: Vec<serde_json::Value> = call(&main, "print_profiles_list", serde_json::json!({})).unwrap();
        assert_eq!(profiles.len(), 10);
        let brand: serde_json::Value = call(&main, "brand_get", serde_json::json!({})).unwrap();
        assert!(brand["garmentColors"].as_array().unwrap().iter().any(|g| g["id"] == "schwarz"));
        let bg: serde_json::Value = call(&main, "bgremove_status", serde_json::json!({})).unwrap();
        assert_eq!(bg["modelFeature"], false);
    }

    #[test]
    fn errors_reach_the_frontend_in_the_contract_form() {
        let (app, _tmp) = app();
        let main = main_window(&app);
        let err = call::<serde_json::Value>(
            &main,
            "install_preview",
            serde_json::json!({ "req": { "programId": "gibtsnicht" } }),
        )
        .unwrap_err();
        assert_eq!(err["kind"], "notFound", "{err}");
        assert_eq!(err["entity"], "program");

        let err = call::<serde_json::Value>(
            &main,
            "project_new_file",
            serde_json::json!({ "req": { "projectId": "x", "templateId": "y", "fileName": "z" } }),
        )
        .unwrap_err();
        assert_eq!(err["kind"], "notFound");

        // das Modellverfahren gibt es noch nicht: der Plan ist unbekannt
        let err = call::<serde_json::Value>(
            &main,
            "bgremove_model_preview",
            serde_json::json!({ "req": { "modelId": "isnet" } }),
        )
        .unwrap_err();
        assert_eq!(err["kind"], "notFound");

        // ohne Zustimmung zu einem unbekannten Plan
        let err = call::<serde_json::Value>(
            &main,
            "setup_preview",
            serde_json::json!({ "req": { "packId": "gibtsnicht", "scopeId": "x" } }),
        )
        .unwrap_err();
        assert_eq!(err["kind"], "notFound");

        // ungültige Eingabe: leerer Projektname
        let err = call::<serde_json::Value>(&main, "project_create", serde_json::json!({ "req": { "name": "  " } }))
            .unwrap_err();
        assert_eq!(err["kind"], "invalidInput");
        assert_eq!(err["field"], "name");
    }

    #[test]
    fn core_events_arrive_as_tauri_events_with_the_contract_names() {
        let (app, _tmp) = app();
        let main = main_window(&app);
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = seen.clone();
        app.listen("projects:changed", move |event| sink.lock().unwrap().push(event.payload().to_owned()));
        let project: serde_json::Value =
            call(&main, "project_create", serde_json::json!({ "req": { "name": "Ereignis" } })).unwrap();
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "{seen:?}");
        assert!(seen[0].contains(project["id"].as_str().unwrap()), "{}", seen[0]);
    }

    #[test]
    fn export_save_image_takes_raw_bytes_and_a_percent_encoded_header() {
        let (app, _tmp) = app();
        let main = main_window(&app);
        let project: serde_json::Value =
            call(&main, "project_create", serde_json::json!({ "req": { "name": "Bilder" } })).unwrap();
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let meta = serde_json::json!({
            "fileName": "Mockup Rot.png",
            "format": "png",
            "destination": { "kind": "project", "projectId": project["id"], "folder": "Export/Social" },
            "dpi": 300
        });
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(
            cypher_core::api::EXPORT_IMAGE_META_HEADER,
            cypher_core::urls::encode_path(&meta.to_string()).parse().unwrap(),
        );
        let mut req = request("export_save_image", serde_json::json!({}));
        req.body = InvokeBody::Raw(png.clone());
        req.headers = headers;
        let saved: serde_json::Value = get_ipc_response(&main, req).map(|r| r.deserialize().unwrap()).unwrap();
        assert_eq!(saved["name"], "Mockup Rot.png");
        assert!(saved["displayPath"].as_str().unwrap().contains("Export"));

        // ohne Kopf oder mit JSON-Körper: Eingabefehler
        let mut no_header = request("export_save_image", serde_json::json!({}));
        no_header.body = InvokeBody::Raw(png);
        let err = get_ipc_response(&main, no_header).unwrap_err();
        assert_eq!(err["kind"], "invalidInput", "{err}");
    }

    #[test]
    fn other_windows_and_plugins_are_not_allowed() {
        let (app, _tmp) = app();
        let other = tauri::WebviewWindowBuilder::new(&app, "fremd", Default::default()).build().unwrap();
        let err = get_ipc_response(&other, request("app_info", serde_json::json!({}))).unwrap_err();
        assert!(err.to_string().contains("not allowed"), "{err}");

        // Dialog-Plugin ist nur aus Rust erlaubt, nicht für das Frontend
        let main = main_window(&app);
        let err =
            get_ipc_response(&main, request("plugin:dialog|open", serde_json::json!({ "options": {} }))).unwrap_err();
        assert!(err.to_string().contains("not allowed"), "{err}");
    }

    fn protocol_request(scheme: &str, path: &str) -> tauri::http::Request<Vec<u8>> {
        tauri::http::Request::builder()
            .method("GET")
            .uri(format!("{scheme}://localhost/{path}"))
            .header("Origin", "tauri://localhost")
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn protocols_serve_only_registered_files_and_package_assets_with_cors_headers() {
        let (app, tmp) = app();
        let core = app.state::<ctx::AppCtx>().app.clone();
        let file = tmp.path().join("motiv.png");
        image::RgbaImage::from_pixel(4, 4, image::Rgba([9, 9, 9, 255])).save(&file).unwrap();
        let handle = core.handles.register(&file, cypher_core::api::HandleSource::Dialog).unwrap();
        let svg = tmp.path().join("bild.svg");
        fs::write(&svg, b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
        let svg_handle = core.handles.register(&svg, cypher_core::api::HandleSource::Dialog).unwrap();

        tauri::async_runtime::block_on(async {
            let ok = protocols::respond(core.clone(), "cyfile", &protocol_request("cyfile", &handle.id)).await;
            assert_eq!(ok.status(), 200);
            assert_eq!(ok.headers()["content-type"], "image/png");
            assert_eq!(ok.headers()["x-content-type-options"], "nosniff");
            assert_eq!(ok.headers()["access-control-allow-origin"], "tauri://localhost");
            assert_eq!(ok.headers()["cache-control"], "no-store");

            for (scheme, path) in [
                ("cyfile", "unbekannt"),
                ("cyfile", svg_handle.id.as_str()),
                ("cyfile", "..%2F..%2Fetc%2Fpasswd"),
                ("cyasset", "..%2FCargo.toml"),
                ("cyasset", "mockups%2F..%2F..%2Fmanifest.json"),
                ("cyasset", "krita/pack.json"),
                ("cythumb", "unbekannt"),
            ] {
                let denied = protocols::respond(core.clone(), scheme, &protocol_request(scheme, path)).await;
                assert_eq!(denied.status(), 404, "{scheme}/{path}");
                assert!(denied.body().is_empty());
                assert_eq!(denied.headers()["access-control-allow-origin"], "tauri://localhost");
            }

            let asset =
                protocols::respond(core.clone(), "cyasset", &protocol_request("cyasset", "mockups/tee-front/mask.png"))
                    .await;
            assert_eq!(asset.status(), 200);
            assert_eq!(asset.headers()["cache-control"], "max-age=86400");
            assert_eq!(asset.headers()["content-type"], "image/png");

            // nur lesen
            let post = tauri::http::Request::builder()
                .method("POST")
                .uri(format!("cyfile://localhost/{}", handle.id))
                .body(Vec::new())
                .unwrap();
            assert_eq!(protocols::respond(core, "cyfile", &post).await.status(), 404);
        });
    }
}
