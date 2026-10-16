//! Versionen aus Text lesen (Programmausgabe, Dateinamen, Ordnernamen).

/// Erste punktnumerische Version im Text (`Blender 5.2.2 LTS` → `5.2.2`, `krita-5.3.4.1-x86_64` → `5.3.4.1`).
/// Mindestens zwei Zahlengruppen, damit Jahreszahlen und Einzelzahlen nicht als Version gelten; höchstens vier.
pub fn extract_version(text: &str) -> Option<String> {
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        let mut j = i;
        let mut groups = 0;
        loop {
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            groups += 1;
            if groups < 4 && j + 1 < b.len() && b[j] == b'.' && b[j + 1].is_ascii_digit() {
                j += 1;
            } else {
                break;
            }
        }
        if groups >= 2 {
            return Some(text[start..j].to_owned());
        }
        i = j.max(i + 1);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_versions_in_typical_program_output() {
        for (text, expected) in [
            ("Blender 5.2.2 LTS", Some("5.2.2")),
            ("Blender 4.5.14\n\tbuild date: 2026-09-15", Some("4.5.14")),
            ("Inkscape 1.4.4 (dcaf3e7, 2026-05-05)", Some("1.4.4")),
            ("kdenlive 26.08.2", Some("26.08.2")),
            ("krita-5.3.4.1-x86_64.AppImage", Some("5.3.4.1")),
            ("Krita (x64) 5.2.9", Some("5.2.9")),
            ("Blender 5.2", Some("5.2")),
            ("Version 7", None),
            ("keine Zahl hier", None),
            ("", None),
        ] {
            assert_eq!(extract_version(text).as_deref(), expected, "{text:?}");
        }
    }
}
