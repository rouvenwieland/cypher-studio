//! Persönliche Pfade und Namen aus Diagnosetexten entfernen (ARCHITEKTUR.md 6.8).
//!
//! Der Heimatordner steht in der Diagnose in mehreren Schreibweisen: roh (`C:\Users\Name`), in JSON verdoppelt
//! (`C:\\Users\\Name`, so landet er in `state.json`), mit Schrägstrichen (`C:/Users/Name`, Dateiadressen), mit `%20` für
//! Leerzeichen und unter Windows als 8.3-Kurzname (`C:\Users\ROUVEN~1`). Groß- und Kleinschreibung ist egal (Windows).
//! Zuletzt wird auch der Benutzername allein ersetzt (zum Beispiel in `DOMÄNE\Name` oder `name@rechner`).

/// Kürzere Benutzernamen werden nicht allein ersetzt: Sie träfen zu viel harmlosen Text (`me`, `a`, `root`).
const MIN_STANDALONE_NAME: usize = 4;
/// Ersatz für den Heimatordner.
const HOME_MARK: &str = "~";
/// Ersatz für einen allein stehenden Benutzernamen.
const USER_MARK: &str = "<benutzer>";

/// Ersetzt `needle` ohne Rücksicht auf ASCII-Groß/Klein (andere Zeichen müssen genau passen).
fn replace_ci(text: &str, needle: &str, replacement: &str) -> String {
    let (t, n) = (text.as_bytes(), needle.as_bytes());
    if n.is_empty() || n.len() > t.len() {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let (mut i, mut last) = (0, 0);
    while i + n.len() <= t.len() {
        // Ein Treffer beginnt und endet immer an Zeichengrenzen: ASCII-Faltung vertauscht nur ASCII mit ASCII
        if t[i..i + n.len()].eq_ignore_ascii_case(n) {
            out.push_str(&text[last..i]);
            out.push_str(replacement);
            i += n.len();
            last = i;
        } else {
            i += 1;
        }
    }
    out.push_str(&text[last..]);
    out
}

/// Ersetzt `name` nur als eigenständiges Wort (davor und danach kein Buchstabe oder keine Ziffer).
fn replace_word_ci(text: &str, name: &str, replacement: &str) -> String {
    let (t, n) = (text.as_bytes(), name.as_bytes());
    if n.is_empty() || n.len() > t.len() {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let (mut i, mut last) = (0, 0);
    while i + n.len() <= t.len() {
        if t[i..i + n.len()].eq_ignore_ascii_case(n) {
            let before = text[..i].chars().next_back();
            let after = text[i + n.len()..].chars().next();
            if !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric) {
                out.push_str(&text[last..i]);
                out.push_str(replacement);
                i += n.len();
                last = i;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&text[last..]);
    out
}

/// Alle Schreibweisen des Heimatordners, längste zuerst.
fn home_variants(home: &str) -> Vec<String> {
    let bare = home.strip_prefix(r"\\?\").unwrap_or(home);
    let bare = bare.trim_end_matches(['/', '\\']);
    if bare.len() < 3 {
        return Vec::new(); // `/` oder `C:`: nichts Persönliches, und der Ersatz würde alles treffen
    }
    let backslash = bare.replace('/', "\\");
    let slash = bare.replace('\\', "/");
    let mut forms = vec![home.to_owned(), backslash.clone(), slash.clone()];
    forms.push(backslash.replace('\\', "\\\\")); // in JSON verdoppelt
    forms.push(slash.replace(' ', "%20")); // Dateiadresse
    forms.push(backslash.replace(' ', "%20"));
    // 8.3-Kurzname des letzten Ordners: erste sechs Zeichen ohne Leerzeichen und Punkte, groß, `~1` bis `~4`
    if let Some((parent, name)) = backslash.rsplit_once('\\') {
        let short: String =
            name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(6).collect::<String>().to_uppercase();
        if !short.is_empty() && (name.len() > 8 || name.contains(' ')) {
            for n in 1..=4 {
                let form = format!("{parent}\\{short}~{n}");
                forms.push(form.replace('\\', "/"));
                forms.push(form.replace('\\', "\\\\"));
                forms.push(form);
            }
        }
    }
    forms.retain(|f| f.len() >= 3);
    forms.sort_by_key(|f| std::cmp::Reverse(f.len()));
    forms.dedup();
    forms
}

/// Entfernt Heimatordner (alle Schreibweisen) und Benutzernamen aus `text`.
///
/// `home` ist der Heimatordner so, wie die App ihn kennt; `users` sind Kontonamen, die allein ersetzt werden sollen
/// (der letzte Ordner von `home` kommt automatisch dazu).
pub fn scrub_text(text: &str, home: &str, users: &[String]) -> String {
    let mut out = text.to_owned();
    for form in home_variants(home) {
        out = replace_ci(&out, &form, HOME_MARK);
    }
    let last_component = home.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("");
    let mut names: Vec<&str> = users.iter().map(String::as_str).chain(std::iter::once(last_component)).collect();
    names.retain(|n| n.chars().count() >= MIN_STANDALONE_NAME && !n.contains(['/', '\\']));
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    names.dedup();
    for name in names {
        out = replace_word_ci(&out, name, USER_MARK);
    }
    out
}

/// Kontonamen aus der Umgebung (Windows: `USERNAME`, sonst `USER` und `LOGNAME`).
pub fn user_names_from_env() -> Vec<String> {
    ["USERNAME", "USER", "LOGNAME"].iter().filter_map(|k| std::env::var(k).ok()).filter(|v| !v.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(value: &serde_json::Value) -> String {
        serde_json::to_string_pretty(value).unwrap()
    }

    #[test]
    fn windows_home_is_removed_in_every_spelling() {
        let home = r"C:\Users\Nevuor";
        // so sieht `state.json` aus: die Backslashes sind verdoppelt (das war der Befund M3)
        let text = json(&serde_json::json!({
            "installPath": format!(r"{home}\AppData\Local\Cypher Studio\programs\blender"),
            "project": "C:/Users/Nevuor/Documents/Cypher/Projekte/Drop",
            "url": "file:///C:/Users/Nevuor/AppData/Local/x.png",
            "verbatim": format!(r"\\?\{home}\Desktop"),
            "klein": r"c:\users\NEVUOR\Downloads",
            "konto": r"DESKTOP-1\Nevuor",
        }));
        assert!(text.contains(r"C:\\Users\\Nevuor"), "Voraussetzung: der Test sieht die verdoppelte Form");
        let clean = scrub_text(&text, home, &[]);
        assert!(!clean.to_lowercase().contains("nevuor"), "Name übrig:\n{clean}");
        assert!(clean.contains(r"~\\AppData\\Local\\Cypher Studio\\programs\\blender"), "{clean}");
        assert!(clean.contains("~/Documents/Cypher/Projekte/Drop"), "{clean}");
        assert!(clean.contains("file:///~/AppData/Local/x.png"), "{clean}");
        assert!(clean.contains(r"DESKTOP-1\\<benutzer>"), "{clean}");
        assert!(clean.contains(r"\\\\?\\~\\Desktop"), "Präfix bleibt erkennbar, der Name ist weg:\n{clean}");
    }

    #[test]
    fn names_with_spaces_and_short_names_are_covered() {
        let home = r"C:\Users\Rouven Wieland";
        let text = json(&serde_json::json!({
            "a": r"C:\Users\Rouven Wieland\x",
            "b": "file:///C:/Users/Rouven%20Wieland/x",
            "c": r"C:\Users\ROUVEN~1\AppData",
            "d": "C:/Users/ROUVEN~1/AppData",
            "e": "angemeldet als Rouven Wieland",
        }));
        let clean = scrub_text(&text, home, &[]);
        let lower = clean.to_lowercase();
        assert!(!lower.contains("rouven"), "Name übrig:\n{clean}");
        assert!(!lower.contains("wieland"), "Name übrig:\n{clean}");
    }

    #[test]
    fn unix_homes_work_and_short_or_unrelated_text_is_left_alone() {
        assert_eq!(scrub_text("/home/nevuor/.local/share/x", "/home/nevuor", &[]), "~/.local/share/x");
        // kurze Namen werden nicht allein ersetzt: sonst würde „root“ oder „me“ in jedem Satz verschwinden
        assert_eq!(scrub_text("run as me, a user in /home/me/x", "/home/me", &[]), "run as me, a user in ~/x");
        // Wurzel und Laufwerk sind kein persönlicher Pfad
        assert_eq!(scrub_text("/usr/bin und C:/Windows", "/", &[]), "/usr/bin und C:/Windows");
        assert_eq!(scrub_text("/usr/bin", "", &[]), "/usr/bin");
    }

    #[test]
    fn account_names_are_replaced_as_whole_words_only() {
        let clean = scrub_text(
            "Konto maximilian und maximilians Rechner, MAXIMILIAN-PC",
            "C:\\Users\\Max",
            &["Maximilian".to_owned()],
        );
        assert_eq!(clean, "Konto <benutzer> und maximilians Rechner, <benutzer>-PC");
    }
}
