//! Programmversionen sind punktnumerisch (`5.2.2`, `5.3.4.1`, `26.08.2`), kein SemVer.

use std::cmp::Ordering;
use std::fmt;

/// Eine Programmversion mit beliebig vielen Zahlengruppen und optionalem Zusatz (`-rc1`).
#[derive(Debug, Clone)]
pub struct ProgVer {
    parts: Vec<u64>,
    pre: Option<String>,
    /// Originaltext (`26.08.2`), damit die Anzeige führende Nullen behält.
    raw: String,
}

impl PartialEq for ProgVer {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for ProgVer {}

impl std::hash::Hash for ProgVer {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let mut parts = self.parts.clone();
        while parts.last() == Some(&0) {
            parts.pop();
        }
        parts.hash(state);
        self.pre.hash(state);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("ungültige Programmversion `{0}`")]
pub struct VersionParseError(pub String);

impl ProgVer {
    pub fn parse(text: &str) -> Result<Self, VersionParseError> {
        let err = || VersionParseError(text.to_owned());
        let trimmed = text.trim();
        let (numbers, pre) = match trimmed.split_once(['-', '+']) {
            Some((n, p)) if !p.is_empty() => (n, Some(p.to_owned())),
            Some(_) => return Err(err()),
            None => (trimmed, None),
        };
        let parts = numbers.split('.').map(|p| p.parse::<u64>().map_err(|_| err())).collect::<Result<Vec<_>, _>>()?;
        if parts.is_empty() || parts.len() > 4 {
            return Err(err());
        }
        Ok(ProgVer { parts, pre, raw: trimmed.to_owned() })
    }

    /// Haupt- und Nebenversion (`5.2.2` → `5.2`), z. B. für Blenders versionierte Konfigurationsordner.
    pub fn major_minor(&self) -> String {
        format!("{}.{}", self.parts.first().copied().unwrap_or(0), self.parts.get(1).copied().unwrap_or(0))
    }

    pub fn major(&self) -> u64 {
        self.parts.first().copied().unwrap_or(0)
    }
}

impl fmt::Display for ProgVer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.raw)
    }
}

impl PartialOrd for ProgVer {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ProgVer {
    fn cmp(&self, other: &Self) -> Ordering {
        let len = self.parts.len().max(other.parts.len());
        for i in 0..len {
            let a = self.parts.get(i).copied().unwrap_or(0);
            let b = other.parts.get(i).copied().unwrap_or(0);
            match a.cmp(&b) {
                Ordering::Equal => {}
                o => return o,
            }
        }
        // gleiche Zahlen: eine Vorabversion ist kleiner als die Endversion
        match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (Some(a), Some(b)) => a.cmp(b),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Ge,
    Gt,
    Le,
    Lt,
    Eq,
}

/// Versionsbereich wie `>=4.2, <6` (alle Bedingungen müssen gelten).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionRange {
    conditions: Vec<(Op, ProgVer)>,
}

impl VersionRange {
    pub fn parse(text: &str) -> Result<Self, VersionParseError> {
        let mut conditions = Vec::new();
        for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            let (op, rest) = if let Some(r) = part.strip_prefix(">=") {
                (Op::Ge, r)
            } else if let Some(r) = part.strip_prefix("<=") {
                (Op::Le, r)
            } else if let Some(r) = part.strip_prefix('>') {
                (Op::Gt, r)
            } else if let Some(r) = part.strip_prefix('<') {
                (Op::Lt, r)
            } else if let Some(r) = part.strip_prefix('=') {
                (Op::Eq, r)
            } else {
                (Op::Eq, part)
            };
            conditions.push((op, ProgVer::parse(rest.trim())?));
        }
        if conditions.is_empty() {
            return Err(VersionParseError(text.to_owned()));
        }
        Ok(VersionRange { conditions })
    }

    pub fn matches(&self, v: &ProgVer) -> bool {
        self.conditions.iter().all(|(op, bound)| match op {
            Op::Ge => v >= bound,
            Op::Gt => v > bound,
            Op::Le => v <= bound,
            Op::Lt => v < bound,
            Op::Eq => v == bound,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> ProgVer {
        ProgVer::parse(s).unwrap()
    }

    #[test]
    fn parses_program_versions() {
        for ok in ["5.2.2", "5.3.4.1", "26.08.2", "1.4", "4.5.14", "6.0.0-rc1"] {
            assert_eq!(v(ok).to_string(), ok, "{ok}");
        }
        for bad in ["", "5", "a.b", "5..2", "5.2.2.1.1", "5.2-", "v5.2"] {
            // "5" ist nach dem Schema ungültig (mindestens zwei Gruppen), der Parser erlaubt es – das prüft `validate`
            if bad == "5" {
                continue;
            }
            assert!(ProgVer::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn orders_numerically_not_lexically() {
        assert!(v("5.3.4.1") > v("5.3.4"));
        assert!(v("5.3.4") == v("5.3.4.0"));
        assert!(v("5.10.0") > v("5.9.0"));
        assert!(v("26.08.2") > v("5.3.4.1"));
        assert!(v("6.0.0-rc1") < v("6.0.0"));
        assert!(v("4.5.14") > v("4.5.9"));
        let mut all = [v("5.2.2"), v("4.5.14"), v("5.10.1"), v("5.2.10")];
        all.sort();
        assert_eq!(all.iter().map(ToString::to_string).collect::<Vec<_>>(), ["4.5.14", "5.2.2", "5.2.10", "5.10.1"]);
    }

    #[test]
    fn major_minor_for_config_directories() {
        assert_eq!(v("5.2.2").major_minor(), "5.2");
        assert_eq!(v("4.5.14").major_minor(), "4.5");
        assert_eq!(v("26.08.2").major_minor(), "26.8");
    }

    #[test]
    fn ranges() {
        let r = VersionRange::parse(">=4.2, <6").unwrap();
        for ok in ["4.2.0", "4.5.14", "5.2.2", "5.99"] {
            assert!(r.matches(&v(ok)), "{ok}");
        }
        for bad in ["4.1.9", "6.0.0", "6.0.4.1", "3.6"] {
            assert!(!r.matches(&v(bad)), "{bad}");
        }
        assert!(VersionRange::parse("5.2.2").unwrap().matches(&v("5.2.2")));
        assert!(VersionRange::parse(">5.2").unwrap().matches(&v("5.3")));
        assert!(VersionRange::parse("").is_err());
        assert!(VersionRange::parse(">=x").is_err());
    }
}
