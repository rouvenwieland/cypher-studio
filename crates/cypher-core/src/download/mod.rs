//! `download` – HTTP mit Fortschritt, Fortsetzen, Abbruch und fester Hostliste (ARCHITEKTUR.md 2.6, 4.2, 6.5).
//!
//! Alle Netzwerkzugriffe der App laufen über [`HttpClient`] (Entscheidung L3). Der Client kennt nur Hosts aus der
//! eingebetteten Liste; der Katalog kann sie nicht erweitern.

mod client;
mod fetch;
mod hosts;

pub use client::{HttpClient, NetLog};
pub use fetch::{
    DownloadProgress, DownloadRequest, DownloadedFile, fetch_small, fetch_small_with_delays, fetch_to_file, probe_size,
    resumable_bytes,
};
pub use hosts::{EMBEDDED_HOSTS, HostPolicy, HostRule, RedirectPolicy};
