//! Hilfen für Tests: Druckprofile aus dem eingebetteten Katalog.

use crate::api::PrintProfile;
use crate::catalog::{Catalog, EMBEDDED_CATALOG_JSON};

fn catalog() -> Catalog {
    serde_json::from_slice(EMBEDDED_CATALOG_JSON).expect("eingebetteter Katalog ist gültig")
}

pub fn profile(id: &str) -> PrintProfile {
    catalog().print_profiles.into_iter().find(|p| p.id == id).expect("Profil im Katalog")
}

pub fn tee_front_profile() -> PrintProfile {
    profile("shirtigo-tee-front")
}
