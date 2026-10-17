//! Commands: brand (Marke, Mockup- und Social-Vorlagen aus den mitgelieferten Paketen).

use cypher_core::api::{Brand, MockupTemplate, SocialTemplate};
use tauri::State;

use super::{R, blocking};
use crate::ctx::AppCtx;

#[tauri::command]
pub async fn brand_get(ctx: State<'_, AppCtx>) -> R<Brand> {
    blocking(&ctx, |core| core.brand_get()).await
}

#[tauri::command]
pub async fn mockup_templates_list(ctx: State<'_, AppCtx>) -> R<Vec<MockupTemplate>> {
    blocking(&ctx, |core| core.mockup_templates_list()).await
}

#[tauri::command]
pub async fn social_templates_list(ctx: State<'_, AppCtx>) -> R<Vec<SocialTemplate>> {
    blocking(&ctx, |core| core.social_templates_list()).await
}
