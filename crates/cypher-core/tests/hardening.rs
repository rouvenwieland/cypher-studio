//! Prüft Festlegungen aus dem Sicherheitsreview, die in Konfigurationsdateien stehen und nicht im Code.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

fn repo_file(rel: &str) -> String {
    std::fs::read_to_string(cypher_core::util::repo_root().join(rel)).unwrap()
}

#[test]
fn release_profile_unwinds_so_that_decoder_panics_can_be_caught() {
    // Befund N14: mit `panic = "abort"` beendet ein Panic in image, tiff, moxcms oder resvg die ganze App
    let toml = repo_file("Cargo.toml");
    let profile = toml.split("[profile.release]").nth(1).expect("[profile.release]");
    let profile = profile.split("\n[").next().unwrap();
    assert!(!profile.lines().any(|l| l.trim().starts_with("panic") && l.contains("abort")), "{profile}");
    assert!(profile.lines().any(|l| l.trim() == "panic = \"unwind\""), "panic = \"unwind\" fehlt:\n{profile}");
}

#[test]
fn the_frontend_forbids_dangerously_set_inner_html() {
    // Befund N15: ARCHITEKTUR 6.4 verspricht die Regel gegen `dangerouslySetInnerHTML`
    // Die Selektoren stehen in eslint.security.js; eslint.config.js bindet sie ein, und ein Vitest-Test lintet Beispiele damit
    let config = repo_file("apps/desktop/eslint.config.js");
    assert!(config.contains("securityRestrictions") && config.contains("securityRules"), "Regeln nicht eingebunden");
    let rules = repo_file("apps/desktop/eslint.security.js");
    assert!(rules.contains("dangerouslySetInnerHTML"), "Regel gegen dangerouslySetInnerHTML fehlt");
}
