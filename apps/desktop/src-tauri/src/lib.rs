//! Cypher Studio – Tauri-Schicht: Plugins, Commands, Protokolle. Die Fachlogik liegt in `cypher-core`.

mod commands;
mod ctx;

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

    builder.manage(ctx::AppCtx::new()).invoke_handler(invoke_handler()).run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::Path;

    use super::*;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
    use tauri::webview::InvokeRequest;

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

    fn app() -> tauri::App<MockRuntime> {
        mock_builder()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .manage(ctx::AppCtx::new())
            .invoke_handler(invoke_handler())
            .build(tauri::generate_context!())
            .unwrap()
    }

    #[test]
    fn commands_are_reachable_from_the_main_window_and_answer_cleanly() {
        let app = app();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let err = get_ipc_response(&main, request("app_info", serde_json::json!({}))).unwrap_err();
        assert_eq!(err["kind"], "internal", "{err}");
        assert!(err["message"].as_str().unwrap().contains("app_info"));
        // Request-Argument und Channel-Parameter werden angenommen (Phase 0: noch nicht gebaut)
        let err = get_ipc_response(&main, request("settings_update", serde_json::json!({ "req": {} }))).unwrap_err();
        assert_eq!(err["kind"], "internal");
    }

    #[test]
    fn other_windows_and_plugins_are_not_allowed() {
        let app = app();
        let other = tauri::WebviewWindowBuilder::new(&app, "fremd", Default::default()).build().unwrap();
        let err = get_ipc_response(&other, request("app_info", serde_json::json!({}))).unwrap_err();
        assert!(err.to_string().contains("not allowed"), "{err}");

        // Dialog-Plugin ist nur aus Rust erlaubt, nicht für das Frontend
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let err =
            get_ipc_response(&main, request("plugin:dialog|open", serde_json::json!({ "options": {} }))).unwrap_err();
        assert!(err.to_string().contains("not allowed"), "{err}");
    }
}
