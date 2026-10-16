//! Grundtypen des Vertrags (Abschnitt 0 von docs/ipc-contract.ts).

pub type IsoDateTime = String;
pub type Sha256Hex = String;
pub type SemVer = String;
pub type ProgramVersion = String;
pub type SpdxId = String;
pub type DisplayPath = String;
pub type AssetUrl = String;
pub type HexColor = String;

pub type ProgramId = String;
pub type InstallationId = String;
pub type PlanId = String;
pub type JobId = String;
pub type FileHandleId = String;
pub type LibraryEntryId = String;
pub type ProjectId = String;
pub type TemplateId = String;
pub type PrintProfileId = String;
pub type GarmentColorId = String;
pub type SetupScopeId = String;
pub type SetupId = String;
pub type MockupTemplateId = String;
pub type SocialTemplateId = String;
pub type PackId = String;

dto_enum! {
    #[derive(Copy, Eq, Hash, PartialOrd, Ord)]
    #[serde(rename_all = "lowercase")]
    pub enum Os {
        Windows,
        Macos,
        Linux,
    }
}

impl Os {
    /// Betriebssystem, für das dieses Binary gebaut wurde.
    pub const fn current() -> Os {
        if cfg!(target_os = "windows") {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Linux
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Os::Windows => "windows",
            Os::Macos => "macos",
            Os::Linux => "linux",
        }
    }
}

impl std::fmt::Display for Os {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

dto_enum! {
    #[derive(Copy, Eq, Hash, PartialOrd, Ord)]
    pub enum Arch {
        #[serde(rename = "x86_64")]
        X86_64,
        #[serde(rename = "aarch64")]
        Aarch64,
    }
}

impl Arch {
    pub const fn as_str(self) -> &'static str {
        match self {
            Arch::X86_64 => "x86_64",
            Arch::Aarch64 => "aarch64",
        }
    }
}

impl std::fmt::Display for Arch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

dto_struct! {
    #[derive(Copy)]
    pub struct Point {
        pub x: f64,
        pub y: f64,
    }
}

dto_struct! {
    #[derive(Copy)]
    pub struct Size {
        pub width: f64,
        pub height: f64,
    }
}

dto_struct! {
    #[derive(Copy)]
    pub struct Rect {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }
}

/// Patch-Feld, das „nicht angegeben“ von `null` (Wert löschen) unterscheidet.
///
/// Im Vertrag: `feld?: T | null`. Die TypeScript-Seite legt das Feld per `#[ts(optional, type = "T | null")]` fest;
/// dieser Typ hat deshalb bewusst keine eigene `TS`-Ableitung.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Patch<T> {
    /// Feld fehlt: nichts ändern.
    #[default]
    Absent,
    /// Feld ist `null`: Wert löschen.
    Null,
    /// Feld hat einen Wert: setzen.
    Value(T),
}

impl<T> Patch<T> {
    pub fn is_absent(&self) -> bool {
        matches!(self, Patch::Absent)
    }

    /// Wendet den Patch auf ein optionales Zielfeld an.
    pub fn apply_to(self, target: &mut Option<T>) {
        match self {
            Patch::Absent => {}
            Patch::Null => *target = None,
            Patch::Value(v) => *target = Some(v),
        }
    }
}

impl<T: serde::Serialize> serde::Serialize for Patch<T> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            // Absent wird über `skip_serializing_if = "Patch::is_absent"` gar nicht erst geschrieben.
            Patch::Absent | Patch::Null => s.serialize_none(),
            Patch::Value(v) => v.serialize(s),
        }
    }
}

impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for Patch<T> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(d)? {
            Some(v) => Patch::Value(v),
            None => Patch::Null,
        })
    }
}
