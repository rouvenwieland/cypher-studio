//! Auswahl von Release und Artefakt für eine Plattform (ARCHITEKTUR.md 2.4, 4.1).

use super::model::{ArtifactArch, ArtifactSpec, Catalog, ProgramSpec, ReleaseSpec};
use super::version::ProgVer;
use crate::api::{Arch, Os, ReleaseChannel};
use crate::error::CatalogError;
use crate::platform::PlatformInfo;

/// Ergebnis der Auswahl.
#[derive(Debug, Clone, Copy)]
pub struct Selection<'a> {
    pub release: &'a ReleaseSpec,
    pub artifact: &'a ArtifactSpec,
    /// macOS: es gibt nur ein Intel-Artefakt für Apple Silicon (läuft über Rosetta 2).
    pub via_rosetta: bool,
}

impl Catalog {
    pub fn program(&self, id: &str) -> Option<&ProgramSpec> {
        self.programs.iter().find(|p| p.id == id)
    }

    pub fn print_profile(&self, id: &str) -> Option<&crate::api::PrintProfile> {
        self.print_profiles.iter().find(|p| p.id == id)
    }

    /// Wählt Release und Artefakt.
    ///
    /// - `version` gesetzt: genau diese Version (Kanal egal).
    /// - sonst `channel` gesetzt: nur dieser Kanal; fehlt er: erst `lts`, dann `stable` (nie `preview`).
    /// - Unter den Kandidaten gewinnt die höchste Version, die ein Artefakt für OS und Architektur hat. So bekommen
    ///   Intel-Macs automatisch Blender 4.5 LTS.
    pub fn release_for(
        &self,
        program_id: &str,
        version: Option<&str>,
        channel: Option<ReleaseChannel>,
        platform: &PlatformInfo,
    ) -> Result<Selection<'_>, CatalogError> {
        let program = self.program(program_id).ok_or_else(|| CatalogError::NotFound(program_id.to_owned()))?;
        let no_artifact =
            || CatalogError::NoArtifact { program: program_id.to_owned(), os: platform.os, arch: platform.arch };

        let pick = |filter: &dyn Fn(&ReleaseSpec) -> bool| -> Option<Selection<'_>> {
            let mut candidates: Vec<(ProgVer, Selection<'_>)> = program
                .releases
                .iter()
                .filter(|r| filter(r))
                .filter_map(|r| {
                    let ver = ProgVer::parse(&r.version).ok()?;
                    let (artifact, via_rosetta) = choose_artifact(&r.artifacts, platform.os, platform.arch)?;
                    Some((ver, Selection { release: r, artifact, via_rosetta }))
                })
                .collect();
            candidates.sort_by(|a, b| b.0.cmp(&a.0));
            candidates.into_iter().next().map(|(_, s)| s)
        };

        if let Some(wanted) = version {
            let wanted = ProgVer::parse(wanted).map_err(|_| no_artifact())?;
            return pick(&|r| ProgVer::parse(&r.version).is_ok_and(|v| v == wanted)).ok_or_else(no_artifact);
        }
        match channel {
            Some(c) => pick(&|r| r.channel == c).ok_or_else(no_artifact),
            None => pick(&|r| r.channel == ReleaseChannel::Lts)
                .or_else(|| pick(&|r| r.channel == ReleaseChannel::Stable))
                .ok_or_else(no_artifact),
        }
    }
}

/// Bestes Artefakt für OS und Architektur: exakte Architektur vor Universal; auf Apple Silicon zuletzt Intel.
fn choose_artifact(artifacts: &[ArtifactSpec], os: Os, arch: Arch) -> Option<(&ArtifactSpec, bool)> {
    let of_os = || artifacts.iter().filter(move |a| a.os == os);
    let exact = |a: &&ArtifactSpec| {
        matches!((a.arch, arch), (ArtifactArch::X86_64, Arch::X86_64) | (ArtifactArch::Aarch64, Arch::Aarch64))
    };
    if let Some(a) = of_os().find(exact) {
        return Some((a, false));
    }
    if let Some(a) = of_os().find(|a| a.arch == ArtifactArch::Universal) {
        return Some((a, false));
    }
    if os == Os::Macos && arch == Arch::Aarch64 {
        return of_os().find(|a| a.arch == ArtifactArch::X86_64).map(|a| (a, true));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ArtifactKind;
    use crate::catalog::model::{ChecksumOrigin, LaunchSpec};

    fn art(os: Os, arch: ArtifactArch) -> ArtifactSpec {
        ArtifactSpec {
            os,
            arch,
            kind: ArtifactKind::Zip,
            installer_type: None,
            url: "https://download.blender.org/x.zip".into(),
            file_name: "x.zip".into(),
            size: 1,
            sha256: "0".repeat(64),
            checksum_source: "https://download.blender.org/x.sha256".into(),
            checksum_origin: ChecksumOrigin::Upstream,
            signature: None,
            strip_components: 0,
            unpacked_size_max: 2,
            mac_app_name: None,
            launch: LaunchSpec {
                exe: "x".into(),
                exe_glob: None,
                args: vec![],
                file_args: Default::default(),
                portable_marker: None,
            },
        }
    }

    fn release(version: &str, channel: ReleaseChannel, artifacts: Vec<ArtifactSpec>) -> ReleaseSpec {
        ReleaseSpec { version: version.into(), channel, released_at: None, artifacts }
    }

    fn catalog(releases: Vec<ReleaseSpec>) -> Catalog {
        use crate::api::{LicenseInfo, ProgramCategory};
        Catalog {
            schema_version: 1,
            sequence: 1,
            generated_at: "2026-10-16T00:00:00Z".into(),
            expires_at: "2027-10-16T00:00:00Z".into(),
            min_app_version: "0.1.0".into(),
            programs: vec![ProgramSpec {
                id: "blender".into(),
                name: "Blender".into(),
                vendor: "Blender Foundation".into(),
                category: ProgramCategory::ThreeD,
                description: "3D".into(),
                homepage: "https://www.blender.org".into(),
                release_notes_url: None,
                license: LicenseInfo {
                    spdx: "GPL-3.0-or-later".into(),
                    name: "GPL".into(),
                    url: "https://www.blender.org".into(),
                },
                detect: Default::default(),
                setup: None,
                releases,
            }],
            links: vec![],
            print_profiles: vec![],
            models: vec![],
        }
    }

    fn blender_like() -> Catalog {
        catalog(vec![
            release(
                "5.2.2",
                ReleaseChannel::Lts,
                vec![
                    art(Os::Windows, ArtifactArch::X86_64),
                    art(Os::Macos, ArtifactArch::Aarch64),
                    art(Os::Linux, ArtifactArch::X86_64),
                ],
            ),
            release("4.5.14", ReleaseChannel::Lts, vec![art(Os::Macos, ArtifactArch::X86_64)]),
            release("5.3.0", ReleaseChannel::Preview, vec![art(Os::Windows, ArtifactArch::X86_64)]),
        ])
    }

    fn select(c: &Catalog, os: Os, arch: Arch) -> Result<(String, bool), CatalogError> {
        c.release_for("blender", None, None, &PlatformInfo::fixed(os, arch))
            .map(|s| (s.release.version.clone(), s.via_rosetta))
    }

    #[test]
    fn newest_lts_for_each_platform_and_intel_macs_get_the_old_lts() {
        let c = blender_like();
        assert_eq!(select(&c, Os::Windows, Arch::X86_64).unwrap(), ("5.2.2".into(), false));
        assert_eq!(select(&c, Os::Linux, Arch::X86_64).unwrap(), ("5.2.2".into(), false));
        assert_eq!(select(&c, Os::Macos, Arch::Aarch64).unwrap(), ("5.2.2".into(), false));
        // Intel-Mac: 5.2.2 hat kein x86_64-Artefakt → 4.5.14
        assert_eq!(select(&c, Os::Macos, Arch::X86_64).unwrap(), ("4.5.14".into(), false));
    }

    #[test]
    fn previews_are_never_chosen_by_default_but_can_be_requested() {
        let c = blender_like();
        let p = PlatformInfo::fixed(Os::Windows, Arch::X86_64);
        assert_eq!(c.release_for("blender", None, Some(ReleaseChannel::Preview), &p).unwrap().release.version, "5.3.0");
        assert_eq!(c.release_for("blender", Some("5.3.0"), None, &p).unwrap().release.version, "5.3.0");
    }

    #[test]
    fn explicit_versions_must_exist_for_the_platform() {
        let c = blender_like();
        let intel = PlatformInfo::fixed(Os::Macos, Arch::X86_64);
        assert!(matches!(c.release_for("blender", Some("5.2.2"), None, &intel), Err(CatalogError::NoArtifact { .. })));
        assert!(matches!(c.release_for("blender", Some("9.9.9"), None, &intel), Err(CatalogError::NoArtifact { .. })));
        assert!(matches!(c.release_for("gimp", None, None, &intel), Err(CatalogError::NotFound(_))));
        assert!(matches!(
            c.release_for("blender", None, None, &PlatformInfo::fixed(Os::Linux, Arch::Aarch64)),
            Err(CatalogError::NoArtifact { .. })
        ));
    }

    #[test]
    fn universal_artifacts_match_both_architectures_and_rosetta_is_the_last_resort() {
        let c =
            catalog(vec![release("5.3.4.1", ReleaseChannel::Stable, vec![art(Os::Macos, ArtifactArch::Universal)])]);
        for arch in [Arch::X86_64, Arch::Aarch64] {
            assert_eq!(select(&c, Os::Macos, arch).unwrap(), ("5.3.4.1".into(), false));
        }
        let c = catalog(vec![release("1.4.4", ReleaseChannel::Stable, vec![art(Os::Macos, ArtifactArch::X86_64)])]);
        assert_eq!(select(&c, Os::Macos, Arch::Aarch64).unwrap(), ("1.4.4".into(), true));
        assert!(matches!(select(&c, Os::Windows, Arch::X86_64), Err(CatalogError::NoArtifact { .. })));
    }

    #[test]
    fn exact_architecture_beats_universal() {
        let c = catalog(vec![release(
            "1.0.0",
            ReleaseChannel::Stable,
            vec![art(Os::Macos, ArtifactArch::Universal), art(Os::Macos, ArtifactArch::Aarch64)],
        )]);
        let s = c.release_for("blender", None, None, &PlatformInfo::fixed(Os::Macos, Arch::Aarch64)).unwrap();
        assert_eq!(s.artifact.arch, ArtifactArch::Aarch64);
    }

    #[test]
    fn lts_wins_over_a_newer_stable_and_stable_is_the_fallback() {
        let c = catalog(vec![
            release("5.2.2", ReleaseChannel::Lts, vec![art(Os::Windows, ArtifactArch::X86_64)]),
            release("5.4.0", ReleaseChannel::Stable, vec![art(Os::Windows, ArtifactArch::X86_64)]),
        ]);
        assert_eq!(select(&c, Os::Windows, Arch::X86_64).unwrap().0, "5.2.2");
        let c = catalog(vec![release("5.4.0", ReleaseChannel::Stable, vec![art(Os::Windows, ArtifactArch::X86_64)])]);
        assert_eq!(select(&c, Os::Windows, Arch::X86_64).unwrap().0, "5.4.0");
    }
}
