//! Build-Skript der Tauri-Schicht.
//!
//! - Jeder App-Command bekommt über `AppManifest` eine eigene Freigabe (`allow-<command>`); ohne Eintrag in
//!   `capabilities/main.json` (über die Sets in `permissions/sets.toml`) kann das Frontend ihn nicht aufrufen.
//! - Die Liste muss mit `COMMAND_NAMES` aus `docs/ipc-contract.ts` übereinstimmen; ein Test in `src/lib.rs`
//!   vergleicht sie mit den registrierten Commands.

use std::path::Path;

/// JSON-Commands des Vertrags (`COMMAND_NAMES`) plus der RAW-Command `export_save_image`.
const COMMANDS: &[&str] = &[
    "app_info",
    "app_open_external",
    "app_reveal",
    "app_close",
    "settings_get",
    "settings_update",
    "settings_choose_dir",
    "network_info",
    "diagnostics_export",
    "catalog_status",
    "catalog_refresh",
    "programs_list",
    "programs_rescan",
    "program_set_preferred",
    "program_add_manual",
    "install_preview",
    "install_start",
    "installation_remove",
    "program_launch",
    "setup_packs_list",
    "setup_status",
    "setup_preview",
    "setup_apply",
    "setup_undo",
    "setup_history",
    "file_pick",
    "export_save_image",
    "samples_list",
    "templates_list",
    "projects_list",
    "project_create",
    "project_new_file",
    "project_open_file",
    "project_open_last",
    "project_file_handle",
    "project_set_collection",
    "project_forget",
    "project_read_document",
    "project_write_document",
    "project_add_asset",
    "library_status",
    "library_choose_root",
    "library_use_root",
    "library_scan",
    "library_query",
    "library_get",
    "library_update_meta",
    "library_bulk_meta",
    "library_import",
    "library_entry_handle",
    "library_set_collections",
    "library_thumbnails_clear",
    "library_pack_export",
    "library_pack_inspect",
    "library_pack_import",
    "print_profiles_list",
    "printcheck_analyze",
    "printcheck_export",
    "printcheck_overlay",
    "brand_get",
    "mockup_templates_list",
    "social_templates_list",
    "app_update_check",
    "app_update_install",
    "jobs_active",
    "jobs_recent",
    "job_cancel",
    "bgremove_status",
    "bgremove_model_preview",
    "bgremove_model_install",
    "bgremove_run",
];

/// Windows: Die Testprogramme (`cargo test`) brauchen wie die App das Manifest mit Common Controls v6. Ohne es startet die
/// Testdatei nicht (`STATUS_ENTRYPOINT_NOT_FOUND`), weil die Dialogbibliothek `TaskDialogIndirect` aus Version 6 verlangt.
/// `tauri-build` bettet das Manifest nur in die App selbst ein. Wer die Tests für Windows baut (zum Beispiel mit
/// `cargo xwin test`), setzt `CYPHER_EMBED_TEST_MANIFEST=1`: dann liefert der Linker das Manifest für alle Dateien, und
/// `tauri-build` legt keins zusätzlich an (sonst gäbe es zwei). Ohne die Variable bleibt alles, wie `tauri-build` es baut.
fn test_manifest_requested() -> bool {
    println!("cargo:rerun-if-env-changed=CYPHER_EMBED_TEST_MANIFEST");
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|env| env == "msvc");
    if !windows_msvc || std::env::var_os("CYPHER_EMBED_TEST_MANIFEST").is_none() {
        return false;
    }
    const MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
"#;
    let Some(out_dir) = std::env::var_os("OUT_DIR") else { return false };
    let file = Path::new(&out_dir).join("test.manifest");
    if std::fs::write(&file, MANIFEST).is_err() {
        return false;
    }
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", file.display());
    true
}

fn main() {
    // Ohne gebautes Frontend (`apps/desktop/dist`) bricht `generate_context!` ab. Für `cargo check/clippy/test`
    // im Debug-Profil legen wir deshalb einen Platzhalter an (der Ordner ist gitignored). Release-Builds brauchen
    // das echte Frontend und scheitern absichtlich, wenn es fehlt.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    if std::env::var("PROFILE").is_ok_and(|p| p == "debug") {
        let dist = Path::new(&manifest_dir).join("../dist");
        if !dist.join("index.html").exists() {
            let _ = std::fs::create_dir_all(&dist);
            let _ = std::fs::write(
                dist.join("index.html"),
                "<!doctype html><meta charset=\"utf-8\"><title>Cypher Studio</title><p>Frontend nicht gebaut (Platzhalter für cargo check/test).</p>\n",
            );
        }
        // Die Pakete (Team C) landen in packs/dist; ohne Build bleibt der Ordner leer.
        let packs_dist = Path::new(&manifest_dir).join("../../../packs/dist");
        let _ = std::fs::create_dir_all(packs_dist);
    }
    println!("cargo:rerun-if-changed=build.rs");
    let own_manifest = test_manifest_requested();

    let app = tauri_build::AppManifest::new().commands(COMMANDS);
    let windows = if own_manifest {
        tauri_build::WindowsAttributes::new_without_app_manifest()
    } else {
        tauri_build::WindowsAttributes::new()
    };
    if let Err(e) = tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app).windows_attributes(windows))
    {
        eprintln!("tauri-build fehlgeschlagen: {e:#}");
        std::process::exit(1);
    }
}
