//! Commands: brand (Phase 0: antworten mit sauberem Fehler, bis das Modul gebaut ist).

#![allow(unused_variables)]

use cypher_core::api::{Brand, MockupTemplate, SocialTemplate};
use tauri::State;

use super::{R, not_built};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn brand_get(ctx: State<'_, AppCtx>) -> R<Brand> {
    not_built("brand_get")
}

#[tauri::command]
pub async fn mockup_templates_list(ctx: State<'_, AppCtx>) -> R<Vec<MockupTemplate>> {
    not_built("mockup_templates_list")
}

#[tauri::command]
pub async fn social_templates_list(ctx: State<'_, AppCtx>) -> R<Vec<SocialTemplate>> {
    not_built("social_templates_list")
}
