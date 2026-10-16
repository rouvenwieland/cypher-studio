// Verhindert ein zusätzliches Konsolenfenster unter Windows im Release-Build. NICHT ENTFERNEN!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(e) = cypher_studio_lib::run() {
        eprintln!("Cypher Studio konnte nicht starten: {e}");
        std::process::exit(1);
    }
}
