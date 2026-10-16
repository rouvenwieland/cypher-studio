//! Farbprofile: Einstufung eingebetteter ICC-Profile, erzeugte Zielprofile (sRGB, Adobe RGB (1998)) und
//! die Umrechnung von RGBA-Pixeln.
//!
//! Die Zielprofile werden mit `moxcms` selbst erzeugt (kein fremdes `.icc` im Repository, keine
//! Lizenzfrage); Primärvalenzen und Gamma 2,2 entsprechen der Adobe-RGB-(1998)-Spezifikation.

use moxcms::{ColorProfile, DataColorSpace, Layout, ProfileText, RenderingIntent, TransformOptions, Xyzd};

use crate::api::{ColorProfileKind, ExportColorProfile};
use crate::error::PrintError;

use super::meta::{Channels, ImageMeta};

/// Abstand der Farbstoffwerte (XYZ, D50), bis zu dem zwei Profile als gleicher Farbraum gelten.
const COLORANT_TOLERANCE: f64 = 0.006;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IccInfo {
    pub kind: ColorProfileKind,
    pub description: Option<String>,
}

/// Lesbarer Name des Profils (`desc`-Tag).
fn description_of(profile: &ColorProfile) -> Option<String> {
    let text = match profile.description.as_ref()? {
        ProfileText::PlainString(s) => s.clone(),
        ProfileText::Localizable(items) => {
            let preferred = items.iter().find(|i| i.language.eq_ignore_ascii_case("en")).or_else(|| items.first())?;
            preferred.value.clone()
        }
        ProfileText::Description(d) => {
            if d.ascii_string.trim().is_empty() {
                d.unicode_string.clone()
            } else {
                d.ascii_string.clone()
            }
        }
    };
    let text = text.trim_matches(|c: char| c.is_whitespace() || c == '\0').to_owned();
    (!text.is_empty()).then_some(text)
}

fn colorants_close(a: &ColorProfile, b: &ColorProfile) -> bool {
    let close = |x: Xyzd, y: Xyzd| {
        (x.x - y.x).abs() < COLORANT_TOLERANCE
            && (x.y - y.y).abs() < COLORANT_TOLERANCE
            && (x.z - y.z).abs() < COLORANT_TOLERANCE
    };
    close(a.red_colorant, b.red_colorant)
        && close(a.green_colorant, b.green_colorant)
        && close(a.blue_colorant, b.blue_colorant)
}

fn has_colorants(p: &ColorProfile) -> bool {
    let sum = |c: Xyzd| c.x.abs() + c.y.abs() + c.z.abs();
    sum(p.red_colorant) > 0.0 && sum(p.green_colorant) > 0.0 && sum(p.blue_colorant) > 0.0
}

fn kind_from_name(name: &str) -> Option<ColorProfileKind> {
    let n = name.to_lowercase();
    if n.contains("adobe rgb") || n.contains("adobergb") {
        Some(ColorProfileKind::AdobeRgb)
    } else if n.contains("display p3") || n.contains("display-p3") || n.contains("displayp3") {
        Some(ColorProfileKind::DisplayP3)
    } else if n.contains("srgb") {
        Some(ColorProfileKind::Srgb)
    } else {
        None
    }
}

/// Stuft ein eingebettetes Profil ein. Unlesbare Profile gelten als `Other`.
pub fn describe_icc(icc: &[u8]) -> IccInfo {
    let Ok(profile) = ColorProfile::new_from_slice(icc) else {
        return IccInfo { kind: ColorProfileKind::Other, description: None };
    };
    let description = description_of(&profile);
    let kind = match profile.color_space {
        DataColorSpace::Gray => ColorProfileKind::Gray,
        DataColorSpace::Cmyk => ColorProfileKind::Cmyk,
        DataColorSpace::Rgb => {
            if has_colorants(&profile) {
                if colorants_close(&profile, &ColorProfile::new_srgb()) {
                    ColorProfileKind::Srgb
                } else if colorants_close(&profile, &ColorProfile::new_adobe_rgb()) {
                    ColorProfileKind::AdobeRgb
                } else if colorants_close(&profile, &ColorProfile::new_display_p3()) {
                    ColorProfileKind::DisplayP3
                } else {
                    ColorProfileKind::Other
                }
            } else {
                // reine Tabellenprofile ohne Farbstoffe: nach dem Namen entscheiden
                description.as_deref().and_then(kind_from_name).unwrap_or(ColorProfileKind::Other)
            }
        }
        _ => ColorProfileKind::Other,
    };
    IccInfo { kind, description }
}

/// Farbraum einer Bilddatei: eingebettetes Profil, sonst `sRGB`-Marke, sonst keines.
pub fn classify(meta: &ImageMeta) -> IccInfo {
    if let Some(icc) = &meta.icc {
        let mut info = describe_icc(icc);
        if meta.channels == Channels::Cmyk {
            info.kind = ColorProfileKind::Cmyk;
        }
        return info;
    }
    if meta.channels == Channels::Cmyk {
        return IccInfo { kind: ColorProfileKind::Cmyk, description: None };
    }
    if meta.srgb_chunk {
        return IccInfo { kind: ColorProfileKind::Srgb, description: None };
    }
    IccInfo { kind: ColorProfileKind::None, description: None }
}

/// Zielprofil als Objekt.
pub fn export_profile(target: ExportColorProfile) -> ColorProfile {
    match target {
        ExportColorProfile::AdobeRgb => ColorProfile::new_adobe_rgb(),
        ExportColorProfile::Srgb => ColorProfile::new_srgb(),
    }
}

/// Zielprofil als ICC-Datei für `iCCP`.
pub fn export_profile_bytes(target: ExportColorProfile) -> Result<Vec<u8>, PrintError> {
    export_profile(target).encode().map_err(|e| PrintError::Encode(format!("ICC-Profil: {e}")))
}

/// Quellprofil für die Umrechnung: das eingebettete RGB-Profil, sonst sRGB.
pub fn source_profile(meta: &ImageMeta) -> ColorProfile {
    if let Some(icc) = &meta.icc
        && let Ok(p) = ColorProfile::new_from_slice(icc)
        && p.color_space == DataColorSpace::Rgb
    {
        return p;
    }
    ColorProfile::new_srgb()
}

/// `true`, wenn die Quelle schon im Zielfarbraum liegt (keine Umrechnung nötig).
pub fn same_space(kind: ColorProfileKind, target: ExportColorProfile) -> bool {
    matches!(
        (kind, target),
        (ColorProfileKind::Srgb, ExportColorProfile::Srgb) | (ColorProfileKind::AdobeRgb, ExportColorProfile::AdobeRgb)
    )
}

/// Rechnet RGBA8-Pixel (gerades Alpha) von `from` nach `to` um; Alpha bleibt unverändert.
pub fn convert_rgba8(rgba: &mut [u8], from: &ColorProfile, to: &ColorProfile) -> Result<(), PrintError> {
    let options =
        TransformOptions { rendering_intent: RenderingIntent::RelativeColorimetric, ..TransformOptions::default() };
    let transform = from
        .create_transform_8bit(Layout::Rgba, to, Layout::Rgba, options)
        .map_err(|e| PrintError::Encode(format!("Farbumrechnung: {e}")))?;
    let src = rgba.to_vec();
    transform.transform(&src, rgba).map_err(|e| PrintError::Encode(format!("Farbumrechnung: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_profiles_are_classified_correctly() {
        for (target, expected) in [
            (ExportColorProfile::Srgb, ColorProfileKind::Srgb),
            (ExportColorProfile::AdobeRgb, ColorProfileKind::AdobeRgb),
        ] {
            let bytes = export_profile_bytes(target).unwrap();
            assert!(bytes.len() > 100);
            assert_eq!(describe_icc(&bytes).kind, expected, "{target:?}");
        }
        let p3 = ColorProfile::new_display_p3().encode().unwrap();
        assert_eq!(describe_icc(&p3).kind, ColorProfileKind::DisplayP3);
    }

    #[test]
    fn adobe_profile_has_a_readable_name() {
        let bytes = export_profile_bytes(ExportColorProfile::AdobeRgb).unwrap();
        let info = describe_icc(&bytes);
        assert_eq!(info.description.as_deref(), Some("Adobe RGB 1998"));
    }

    #[test]
    fn broken_profile_is_other_not_a_panic() {
        assert_eq!(describe_icc(b"kein Profil").kind, ColorProfileKind::Other);
        assert_eq!(describe_icc(&[]).kind, ColorProfileKind::Other);
    }

    #[test]
    fn name_fallback_for_table_only_profiles() {
        assert_eq!(kind_from_name("sRGB IEC61966-2.1"), Some(ColorProfileKind::Srgb));
        assert_eq!(kind_from_name("Adobe RGB (1998)"), Some(ColorProfileKind::AdobeRgb));
        assert_eq!(kind_from_name("Display P3"), Some(ColorProfileKind::DisplayP3));
        assert_eq!(kind_from_name("Irgendwas"), None);
    }

    #[test]
    fn srgb_to_adobe_keeps_neutral_greys_and_alpha_and_widens_saturated_colours() {
        let mut px = vec![128, 128, 128, 200, 255, 0, 0, 77, 0, 0, 0, 255];
        convert_rgba8(&mut px, &ColorProfile::new_srgb(), &ColorProfile::new_adobe_rgb()).unwrap();
        // neutrales Grau bleibt (fast) neutral
        let (r, g, b) = (i32::from(px[0]), i32::from(px[1]), i32::from(px[2]));
        assert!((r - g).abs() <= 1 && (g - b).abs() <= 1, "{r} {g} {b}");
        // Alpha unverändert
        assert_eq!((px[3], px[7], px[11]), (200, 77, 255));
        // gesättigtes sRGB-Rot ist in Adobe RGB weniger extrem (Gamut größer): R < 255
        assert!(px[4] < 255 && px[4] > 200, "{}", px[4]);
        // Schwarz bleibt Schwarz
        assert_eq!(&px[8..11], &[0, 0, 0]);
    }

    #[test]
    fn same_space_only_for_matching_supported_profiles() {
        assert!(same_space(ColorProfileKind::Srgb, ExportColorProfile::Srgb));
        assert!(same_space(ColorProfileKind::AdobeRgb, ExportColorProfile::AdobeRgb));
        assert!(!same_space(ColorProfileKind::Srgb, ExportColorProfile::AdobeRgb));
        assert!(!same_space(ColorProfileKind::None, ExportColorProfile::Srgb));
    }
}
