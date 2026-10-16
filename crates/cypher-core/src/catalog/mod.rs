//! `catalog` – Programm-Katalog: Laden, Signaturprüfung, Schema, Auswahl (ARCHITEKTUR.md 2.4, 4.1, 5.8).
//!
//! Der Katalog ist reines JSON (keine Ausdrücke, keine Schreibziele) und mit minisign signiert. Die App bettet
//! den Katalog von `main` ein; der Remote-Katalog wird nur übernommen, wenn Signatur, Schema, Hostliste und
//! Sequenz stimmen.

mod model;
mod select;
mod store;
mod validate;
mod version;

pub use model::*;
pub use select::Selection;
pub use store::{
    CATALOG_URLS, CatalogStore, EMBEDDED_CATALOG_JSON, EMBEDDED_CATALOG_SIG, EMBEDDED_KEYS, LoadedCatalog,
    MAX_CATALOG_BYTES, RefreshOutcome, embedded, parse_and_verify,
};
pub use validate::{CatalogWarning, SUPPORTED_SCHEMA_VERSION, validate};
pub use version::{ProgVer, VersionParseError, VersionRange};
