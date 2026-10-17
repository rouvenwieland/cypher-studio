//! Die Adressen des Projekts an einer Stelle (Quellcode-Repository, App-Seiten, Katalog- und Update-Quellen).
//!
//! Alles, was eine dieser Adressen braucht, nimmt sie von hier. Tests halten die Stücke zusammen: `Cargo.toml`
//! (`repository`) und `tauri.conf.json` (Update-Endpunkte) müssen zu diesen Konstanten passen.

/// Besitzer und Name des Quellcode-Repositories auf GitHub.
pub const REPOSITORY_SLUG: &str = "rouvenwieland/cypher-studio";
/// Das Quellcode-Repository.
pub const REPOSITORY_URL: &str = "https://github.com/rouvenwieland/cypher-studio";

/// Die Seite der App (Downloads, Anleitung, Versionshinweise).
pub const SITE_URL: &str = "https://studio.cypherxcypher.de";
pub const SITE_HELP_URL: &str = "https://studio.cypherxcypher.de/anleitung/";
pub const SITE_RELEASES_URL: &str = "https://studio.cypherxcypher.de/releases/";

/// Katalogquelle 1: die Seite der App.
pub const CATALOG_SITE_URL: &str = "https://studio.cypherxcypher.de/catalog/v1/catalog.json";
/// Katalogquelle 2: das Repository (antwortet mit 404, solange es privat ist).
pub const CATALOG_REPOSITORY_URL: &str =
    "https://raw.githubusercontent.com/rouvenwieland/cypher-studio/main/catalog/catalog.json";

/// Update-Quelle 1 (Tauri-Updater): die Seite der App.
pub const UPDATE_SITE_URL: &str = "https://studio.cypherxcypher.de/releases/latest.json";
/// Update-Quelle 2: die Veröffentlichungen im Repository.
pub const UPDATE_REPOSITORY_URL: &str =
    "https://github.com/rouvenwieland/cypher-studio/releases/latest/download/latest.json";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_matches_cargo_manifest() {
        assert_eq!(REPOSITORY_URL, env!("CARGO_PKG_REPOSITORY"));
        assert_eq!(REPOSITORY_URL, format!("https://github.com/{REPOSITORY_SLUG}"));
    }

    #[test]
    fn derived_addresses_use_the_one_repository() {
        assert!(UPDATE_REPOSITORY_URL.starts_with(&format!("{REPOSITORY_URL}/releases/")));
        assert_eq!(
            CATALOG_REPOSITORY_URL,
            format!("https://raw.githubusercontent.com/{REPOSITORY_SLUG}/main/catalog/catalog.json")
        );
        assert!(CATALOG_SITE_URL.starts_with(SITE_URL));
        assert!(UPDATE_SITE_URL.starts_with(SITE_URL));
        assert!(SITE_HELP_URL.starts_with(SITE_URL));
        assert!(SITE_RELEASES_URL.starts_with(SITE_URL));
    }

    #[test]
    fn no_address_points_to_the_old_organisation() {
        for url in [
            REPOSITORY_URL,
            SITE_URL,
            SITE_HELP_URL,
            SITE_RELEASES_URL,
            CATALOG_SITE_URL,
            CATALOG_REPOSITORY_URL,
            UPDATE_SITE_URL,
            UPDATE_REPOSITORY_URL,
        ] {
            assert!(!url.contains("cypher-kollektiv"), "{url}");
        }
    }
}
