//! Hilfsmakros für die DTOs des IPC-Vertrags.
//!
//! Alle DTOs tragen dieselben Ableitungen: Serde mit camelCase und ts-rs. Exportiert (also als eigene
//! Datei in `apps/desktop/src/ipc/generated/` erzeugt) werden nur Typen, die im Vertrag einen Namen haben;
//! namenlose Teilobjekte des Vertrags sind `inline_*`-Typen und werden am Feld mit `#[ts(inline)]` eingefaltet.

/// Struct mit Serde camelCase und TypeScript-Export.
macro_rules! dto_struct {
    ($(#[$m:meta])* pub struct $name:ident { $($body:tt)* }) => {
        #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
        $(#[$m])*
        #[serde(rename_all = "camelCase")]
        #[ts(export)]
        pub struct $name { $($body)* }
    };
}

/// Struct ohne eigenen TypeScript-Export (wird am Feld mit `#[ts(inline)]` eingefaltet).
macro_rules! inline_struct {
    ($(#[$m:meta])* pub struct $name:ident { $($body:tt)* }) => {
        #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
        $(#[$m])*
        #[serde(rename_all = "camelCase")]
        pub struct $name { $($body)* }
    };
}

/// Enum (String-Union oder getaggte Union) mit TypeScript-Export. Serde-Attribute setzt der Aufrufer.
macro_rules! dto_enum {
    ($(#[$m:meta])* pub enum $name:ident { $($body:tt)* }) => {
        #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
        $(#[$m])*
        #[ts(export)]
        pub enum $name { $($body)* }
    };
}

/// Enum ohne eigenen TypeScript-Export (am Feld mit `#[ts(inline)]` eingefaltet).
macro_rules! inline_enum {
    ($(#[$m:meta])* pub enum $name:ident { $($body:tt)* }) => {
        #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
        $(#[$m])*
        pub enum $name { $($body)* }
    };
}
