//! Einrichtung anwenden, zurücknehmen und nach Abbrüchen aufräumen (ARCHITEKTUR.md 2.10, 4.4, 5.2).
//!
//! Regeln: Nie still überschreiben. Jede ersetzte Datei wird vorher gesichert. Jeder Schritt landet sofort im Journal, damit
//! ein Abbruch oder Absturz zurückgerollt werden kann. Ohne Änderung entsteht kein neuer Eintrag (zweites Anwenden ist
//! ein Nullaufwand und lässt das Zurücknehmen der ersten Einrichtung möglich).

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::api::{
    AppError, ConflictResolution, IoOp, ScopeKind, SetupEvent, SetupFailure, SetupOperation, SetupOperationKind,
    SetupRecord, SetupRecordStatus, SetupScope, SetupStatus, SetupSummary, UndoReport,
};
use crate::error::{IoError, SetupError};
use crate::platform::{display_path, fsx};
use crate::process::CommandRunner;
use crate::progress::ProgressSink;
use crate::util::{new_id, now_iso};

use super::fonts::FontInstaller;
use super::pack::PackManifest;
use super::plan::{Decision, ItemKind, PlanItem, SetupPlanData, latest_manifest};
use super::roots::{ResolvedScope, RootId};
use super::store::{
    ActionEntry, BackupRef, EntryOp, FailureEntry, FontEntry, Journal, JournalState, MANIFEST_FORMAT_VERSION, Manifest,
    ManifestEntry, ManifestStatus, SetupStore,
};
use super::{hash_bytes, hash_file};

/// Zeitlimit für die Blender-Kommandozeile (Erweiterung installieren).
pub const BLENDER_CLI_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Default)]
pub struct ApplySelection {
    pub components: Vec<String>,
    pub resolutions: BTreeMap<String, ConflictResolution>,
}

pub struct ApplyEnv<'a> {
    pub store: &'a SetupStore,
    pub runner: &'a dyn CommandRunner,
    pub fonts: &'a dyn FontInstaller,
    pub job_id: &'a str,
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), SetupError> {
    if cancel.is_cancelled() { Err(SetupError::Cancelled) } else { Ok(()) }
}

fn to_status(s: ManifestStatus) -> SetupRecordStatus {
    match s {
        ManifestStatus::Applied => SetupRecordStatus::Applied,
        ManifestStatus::Partial => SetupRecordStatus::Partial,
        ManifestStatus::Undone => SetupRecordStatus::Undone,
    }
}

fn failure_dto(m: &Manifest, f: &FailureEntry) -> SetupFailure {
    let target = m.roots.get(&f.root).map(|r| Path::new(r).join(&f.rel)).unwrap_or_else(|| PathBuf::from(&f.rel));
    let shown = display_path(&target);
    let error = if f.message.starts_with("permission:") {
        AppError::PermissionDenied { path: shown.clone() }
    } else if let Some(msg) = f.message.strip_prefix("io:") {
        AppError::Io { op: IoOp::Write, path: Some(shown.clone()), message: msg.trim().to_owned() }
    } else {
        AppError::internal(f.message.clone())
    };
    SetupFailure { target: shown, error }
}

/// Eintrag des Verlaufs für die Oberfläche.
pub fn record_of(m: &Manifest, undo_available: bool) -> SetupRecord {
    SetupRecord {
        setup_id: m.setup_id.clone(),
        pack_id: m.pack_id.clone(),
        program_id: m.program_id.clone(),
        scope_id: m.scope_id.clone(),
        pack_version: m.pack_version.clone(),
        components: m.components.clone(),
        applied_at: m.applied_at.clone(),
        status: to_status(m.status),
        files_written: m.entries.len() as u32,
        backups_taken: m.entries.iter().filter(|e| e.backup.is_some()).count() as u32,
        undo_available: undo_available && m.status != ManifestStatus::Undone,
        failures: m.failures.iter().map(|f| failure_dto(m, f)).collect(),
    }
}

fn failure_message(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied { format!("permission: {e}") } else { format!("io: {e}") }
}

fn target_of(roots: &BTreeMap<RootId, String>, root: RootId, rel: &str) -> Option<PathBuf> {
    fsx::safe_join(Path::new(roots.get(&root)?), rel).ok()
}

/// Ordner entfernen, solange sie leer sind (nie die Wurzel selbst).
fn prune_empty_parents(file: &Path, root_dir: &Path) {
    let mut dir = file.parent();
    while let Some(d) = dir {
        if d == root_dir || !d.starts_with(root_dir) {
            break;
        }
        if std::fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
}

fn write_target(target: &Path, bytes: &[u8]) -> Result<(), IoError> {
    fsx::write_atomic(target, bytes)
}

fn back_up(store: &SetupStore, setup_id: &str, root: RootId, rel: &str, target: &Path) -> Result<BackupRef, IoError> {
    let store_rel = SetupStore::backup_rel(setup_id, root, rel);
    let dest = store.root().join(&store_rel);
    let old = std::fs::read(target).map_err(|e| IoError::read(target, e))?;
    fsx::write_atomic(&dest, &old)?;
    Ok(BackupRef { rel: store_rel, sha256: hash_bytes(&old) })
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Outcome {
    /// Datei ist schon so, wie sie sein soll.
    Skipped,
    /// Nutzer wollte eine abweichende Datei behalten.
    Declined,
    Written,
    Failed,
}

/// Wendet einen Plan an. `sel.components` plus alle Pflichtbausteine werden eingerichtet.
pub fn apply(
    plan: SetupPlanData,
    sel: &ApplySelection,
    env: &ApplyEnv<'_>,
    sink: &dyn ProgressSink<SetupEvent>,
    cancel: &CancellationToken,
) -> Result<SetupRecord, SetupError> {
    let result = apply_inner(plan, sel, env, sink, cancel);
    // Schriftenanmeldung einmal für den ganzen Stapel abschließen (nicht je Datei), auch bei Abbruch und Fehler
    env.fonts.flush();
    result
}

fn apply_inner(
    plan: SetupPlanData,
    sel: &ApplySelection,
    env: &ApplyEnv<'_>,
    sink: &dyn ProgressSink<SetupEvent>,
    cancel: &CancellationToken,
) -> Result<SetupRecord, SetupError> {
    let pack = &plan.pack;
    let in_plan: BTreeSet<&str> = plan.dto.components.iter().map(|c| c.id.as_str()).collect();

    // --- Auswahl ---------------------------------------------------------------------------------
    let mut selected: BTreeSet<String> = BTreeSet::new();
    for id in &sel.components {
        if !in_plan.contains(id.as_str()) {
            return Err(SetupError::InvalidInput {
                field: "components".into(),
                reason: format!("Baustein `{id}` gibt es in diesem Plan nicht"),
            });
        }
        selected.insert(id.clone());
    }
    for c in pack.components.iter().filter(|c| !c.optional && in_plan.contains(c.id.as_str())) {
        selected.insert(c.id.clone());
    }
    // Ein gewählter Ausweichweg ersetzt den Baustein, für den er gilt (nie beide zusammen)
    let replaced: Vec<String> =
        pack.components.iter().filter(|c| selected.contains(&c.id)).filter_map(|c| c.fallback_for.clone()).collect();
    for id in replaced {
        selected.remove(&id);
    }
    let items: Vec<&PlanItem> = plan.items.iter().filter(|i| selected.contains(&i.component)).collect();

    // --- Quellen prüfen, bevor etwas geschrieben wird ----------------------------------------------
    for item in &items {
        let (path, expected) = match &item.kind {
            ItemKind::File { src, .. } => (src, &item.sha256),
            ItemKind::BlenderExtension { zip, run: true, .. } => (zip, &item.sha256),
            _ => continue,
        };
        if matches!(item.kind, ItemKind::File { .. }) && matches!(item.decision, Decision::Skip) {
            continue;
        }
        if hash_file(path)? != *expected {
            return Err(SetupError::InvalidPack(format!(
                "{}: Quelldatei {} ist beschädigt (Prüfsumme stimmt nicht)",
                pack.id,
                display_path(path)
            )));
        }
    }

    let resolution_of = |item: &PlanItem| -> ConflictResolution {
        match &item.decision {
            Decision::Conflict { conflict_id, .. } => {
                sel.resolutions.get(conflict_id).copied().unwrap_or(ConflictResolution::Skip)
            }
            _ => ConflictResolution::Overwrite,
        }
    };
    let will_work = |item: &PlanItem| -> bool {
        match &item.kind {
            ItemKind::File { .. } | ItemKind::Config { .. } => match &item.decision {
                Decision::Skip => false,
                Decision::Conflict { .. } => resolution_of(item) != ConflictResolution::Skip,
                _ => true,
            },
            ItemKind::Font { run, .. } | ItemKind::BlenderExtension { run, .. } => *run,
        }
    };
    let total = items.iter().filter(|i| will_work(i)).count() as u32;

    let setup_id = new_id();
    let roots_text: BTreeMap<RootId, String> =
        plan.scope.roots.iter().map(|(k, v)| (*k, v.to_string_lossy().into_owned())).collect();
    let mut journal = Journal {
        state: JournalState::Applying,
        setup_id: setup_id.clone(),
        entries: Vec::new(),
        fonts: Vec::new(),
        roots: roots_text.clone(),
    };
    env.store.save_journal(&journal)?;
    sink.emit(SetupEvent::Started { job_id: env.job_id.to_owned(), total });

    let mut actions: Vec<ActionEntry> = Vec::new();
    let mut failures: Vec<FailureEntry> = Vec::new();
    let mut outcomes: BTreeMap<String, Outcome> = BTreeMap::new();
    let mut index = 0u32;

    for item in &items {
        if let Err(e) = check_cancel(cancel) {
            rollback(env.store, env.fonts, &roots_text, &journal.entries, &journal.fonts, &BTreeSet::new());
            env.store.remove_journal(&setup_id);
            env.store.remove_backups(&setup_id);
            return Err(e);
        }
        if !will_work(item) {
            if let ItemKind::File { .. } = item.kind {
                let declined = matches!(item.decision, Decision::Conflict { .. });
                outcomes.insert(item.source_id.clone(), if declined { Outcome::Declined } else { Outcome::Skipped });
            }
            continue;
        }
        index += 1;
        let operation = |kind: SetupOperationKind| SetupOperation {
            kind,
            target: display_path(&item.target),
            source_id: item.source_id.clone(),
            bytes: item.bytes,
            conflict_id: match &item.decision {
                Decision::Conflict { conflict_id, .. } => Some(conflict_id.clone()),
                _ => None,
            },
        };
        match &item.kind {
            ItemKind::File { src, .. } => {
                sink.emit(SetupEvent::Step {
                    index,
                    total,
                    component_id: item.component.clone(),
                    operation: operation(op_kind(&item.decision)),
                });
                let bytes = std::fs::read(src).map_err(|e| IoError::read(src, e))?;
                let r = write_item(env, &setup_id, &plan.scope, item, &bytes, resolution_of(item));
                finish_write(r, item, &mut outcomes, &mut failures, &mut journal, env.store)?;
            }
            ItemKind::Config { content } => {
                sink.emit(SetupEvent::Step {
                    index,
                    total,
                    component_id: item.component.clone(),
                    operation: operation(SetupOperationKind::WriteConfig),
                });
                let r = write_item(env, &setup_id, &plan.scope, item, content, resolution_of(item));
                finish_write(r, item, &mut outcomes, &mut failures, &mut journal, env.store)?;
            }
            ItemKind::Font { file_id, display_name, .. } => {
                sink.emit(SetupEvent::Step {
                    index,
                    total,
                    component_id: item.component.clone(),
                    operation: operation(SetupOperationKind::InstallFont),
                });
                // Nur anmelden, wenn die Datei da ist und von uns stammt (nicht übersprungener Konflikt, nicht fehlgeschlagen)
                let file_ok = !matches!(outcomes.get(file_id), Some(Outcome::Failed | Outcome::Declined));
                if file_ok && item.target.exists() {
                    match env.fonts.register(&item.target, display_name) {
                        Ok(registry_name) => {
                            let entry = FontEntry {
                                root: item.root,
                                rel: item.rel.clone(),
                                display_name: display_name.clone(),
                                registry_name,
                            };
                            journal.fonts.push(entry);
                            env.store.save_journal(&journal)?;
                        }
                        Err(e) => failures.push(FailureEntry {
                            root: item.root,
                            rel: item.rel.clone(),
                            message: failure_message(&e),
                        }),
                    }
                }
            }
            ItemKind::BlenderExtension { zip, .. } => {
                sink.emit(SetupEvent::Step {
                    index,
                    total,
                    component_id: item.component.clone(),
                    operation: operation(SetupOperationKind::BlenderExtension),
                });
                match run_blender_extension(env.runner, plan.scope.exe.as_deref(), zip) {
                    Ok(code) => {
                        if code != Some(0) {
                            failures.push(FailureEntry {
                                root: item.root,
                                rel: item.rel.clone(),
                                message: format!("Blender hat die Erweiterung nicht installiert (Exit-Code {code:?})"),
                            });
                        }
                        actions.push(ActionEntry {
                            kind: "blenderExtensionInstall".into(),
                            sha256: item.sha256.clone(),
                            exit_code: code,
                        });
                    }
                    Err(message) => failures.push(FailureEntry { root: item.root, rel: item.rel.clone(), message }),
                }
            }
        }
    }

    let nothing_changed = journal.entries.is_empty() && journal.fonts.is_empty() && actions.is_empty();
    if nothing_changed && failures.is_empty() {
        env.store.remove_journal(&setup_id);
        env.store.remove_backups(&setup_id);
        let record = match latest_manifest(env.store, &pack.id, &plan.scope.scope_id) {
            Some(prev) => record_of(&prev, true),
            None => {
                // Alles war schon vorhanden: trotzdem festhalten, damit der Bereich als eingerichtet gilt
                let m = new_manifest(
                    &setup_id,
                    env.store.next_sequence(),
                    &plan,
                    &selected,
                    roots_text,
                    ManifestStatus::Applied,
                    vec![],
                    vec![],
                    vec![],
                    vec![],
                );
                env.store.save_manifest(&m)?;
                record_of(&m, true)
            }
        };
        sink.emit(SetupEvent::Finished { record: record.clone() });
        return Ok(record);
    }

    let status = if failures.is_empty() { ManifestStatus::Applied } else { ManifestStatus::Partial };
    let manifest = new_manifest(
        &setup_id,
        env.store.next_sequence(),
        &plan,
        &selected,
        roots_text,
        status,
        journal.entries.clone(),
        journal.fonts.clone(),
        actions,
        failures,
    );
    env.store.save_manifest(&manifest)?;
    env.store.remove_journal(&setup_id);
    let record = record_of(&manifest, true);
    sink.emit(SetupEvent::Finished { record: record.clone() });
    Ok(record)
}

fn op_kind(d: &Decision) -> SetupOperationKind {
    match d {
        Decision::Create => SetupOperationKind::Create,
        Decision::Update => SetupOperationKind::Update,
        Decision::Skip => SetupOperationKind::Skip,
        Decision::Conflict { .. } => SetupOperationKind::Conflict,
    }
}

#[allow(clippy::too_many_arguments)]
fn new_manifest(
    setup_id: &str,
    sequence: u64,
    plan: &SetupPlanData,
    selected: &BTreeSet<String>,
    roots: BTreeMap<RootId, String>,
    status: ManifestStatus,
    entries: Vec<ManifestEntry>,
    fonts: Vec<FontEntry>,
    actions: Vec<ActionEntry>,
    failures: Vec<FailureEntry>,
) -> Manifest {
    Manifest {
        format_version: MANIFEST_FORMAT_VERSION,
        setup_id: setup_id.to_owned(),
        pack_id: plan.pack.id.clone(),
        program_id: plan.scope.program_id.clone(),
        pack_version: plan.pack.version.clone(),
        scope_id: plan.scope.scope_id.clone(),
        scope_kind: plan.scope.kind,
        roots,
        applied_at: now_iso(),
        status,
        components: plan.pack.components.iter().filter(|c| selected.contains(&c.id)).map(|c| c.id.clone()).collect(),
        entries,
        fonts,
        actions,
        failures,
        undone_at: None,
        sequence,
    }
}

type WriteResult = Result<Option<ManifestEntry>, IoError>;

/// Schreibt eine Datei nach der Entscheidung des Plans. Gibt den Manifesteintrag zurück (`None` = nichts getan).
fn write_item(
    env: &ApplyEnv<'_>,
    setup_id: &str,
    scope: &ResolvedScope,
    item: &PlanItem,
    bytes: &[u8],
    resolution: ConflictResolution,
) -> WriteResult {
    let make = |op: EntryOp, rel: &str, backup: Option<BackupRef>| ManifestEntry {
        component: item.component.clone(),
        root: item.root,
        rel: rel.to_owned(),
        op,
        sha256: item.sha256.clone(),
        bytes: bytes.len() as u64,
        backup,
    };
    match &item.decision {
        Decision::Skip => Ok(None),
        Decision::Create => {
            write_target(&item.target, bytes)?;
            Ok(Some(make(EntryOp::Create, &item.rel, None)))
        }
        Decision::Update => {
            let backup = back_up(env.store, setup_id, item.root, &item.rel, &item.target)?;
            write_target(&item.target, bytes)?;
            Ok(Some(make(EntryOp::Update, &item.rel, Some(backup))))
        }
        Decision::Conflict { keep_both_rel, .. } => match resolution {
            ConflictResolution::Skip => Ok(None),
            ConflictResolution::Overwrite => {
                if item.target.is_dir() {
                    return Err(IoError::write(
                        &item.target,
                        std::io::Error::other("an dieser Stelle liegt ein Ordner"),
                    ));
                }
                let backup = back_up(env.store, setup_id, item.root, &item.rel, &item.target)?;
                write_target(&item.target, bytes)?;
                Ok(Some(make(EntryOp::Overwrite, &item.rel, Some(backup))))
            }
            ConflictResolution::KeepBoth => {
                let root_dir = scope
                    .roots
                    .get(&item.root)
                    .ok_or_else(|| IoError::write(&item.target, std::io::Error::other("Wurzel fehlt")))?;
                let alt = fsx::safe_join(root_dir, keep_both_rel)
                    .map_err(|e| IoError::write(&item.target, std::io::Error::other(e.to_string())))?;
                write_target(&alt, bytes)?;
                Ok(Some(make(EntryOp::KeepBoth, keep_both_rel, None)))
            }
        },
    }
}

fn finish_write(
    result: WriteResult,
    item: &PlanItem,
    outcomes: &mut BTreeMap<String, Outcome>,
    failures: &mut Vec<FailureEntry>,
    journal: &mut Journal,
    store: &SetupStore,
) -> Result<(), SetupError> {
    match result {
        Ok(Some(entry)) => {
            outcomes.insert(item.source_id.clone(), Outcome::Written);
            journal.entries.push(entry);
            store.save_journal(journal)?;
        }
        Ok(None) => {
            let declined = matches!(item.decision, Decision::Conflict { .. });
            outcomes.insert(item.source_id.clone(), if declined { Outcome::Declined } else { Outcome::Skipped });
        }
        Err(e) => {
            outcomes.insert(item.source_id.clone(), Outcome::Failed);
            failures.push(FailureEntry { root: item.root, rel: item.rel.clone(), message: failure_message(&e.source) });
        }
    }
    Ok(())
}

/// Blender-Kommandozeile: Erweiterung aus ZIP installieren und aktivieren.
fn run_blender_extension(runner: &dyn CommandRunner, exe: Option<&Path>, zip: &Path) -> Result<Option<i32>, String> {
    let Some(exe) = exe else {
        return Err("Keine Blender-Startdatei bekannt; die Erweiterung wurde nicht installiert".into());
    };
    let args: Vec<OsString> = ["--command", "extension", "install-file", "--repo", "user_default", "--enable"]
        .iter()
        .map(OsString::from)
        .chain(std::iter::once(zip.as_os_str().to_owned()))
        .collect();
    match runner.run(exe, &args, BLENDER_CLI_TIMEOUT) {
        Ok(out) => Ok(out.code),
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
            Err("Blender hat nicht innerhalb von 120 Sekunden geantwortet".into())
        }
        Err(e) => Err(format!("Blender ließ sich nicht starten: {e}")),
    }
}

// ---------------------------------------------------------------------------------------------
// Zurücknehmen
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default)]
struct RollbackReport {
    restored: u32,
    removed: u32,
    kept_modified: Vec<PathBuf>,
    fonts_removed: u32,
}

/// Macht Einträge rückwärts rückgängig. `keep` = Pfade, die eine andere aktive Einrichtung noch braucht.
fn rollback(
    store: &SetupStore,
    fonts: &dyn FontInstaller,
    roots: &BTreeMap<RootId, String>,
    entries: &[ManifestEntry],
    font_entries: &[FontEntry],
    keep: &BTreeSet<PathBuf>,
) -> RollbackReport {
    let mut report = RollbackReport::default();
    for f in font_entries.iter().rev() {
        let Some(path) = target_of(roots, f.root, &f.rel) else { continue };
        if keep.contains(&path) {
            continue;
        }
        if fonts.unregister(&path, f.registry_name.as_deref()).is_ok() {
            report.fonts_removed += 1;
        }
    }
    fonts.flush();
    for e in entries.iter().rev() {
        let Some(target) = target_of(roots, e.root, &e.rel) else { continue };
        if keep.contains(&target) {
            continue;
        }
        let root_dir = roots.get(&e.root).map(PathBuf::from).unwrap_or_default();
        let current = if target.is_file() { hash_file(&target).ok() } else { None };
        let ours = current.as_deref() == Some(e.sha256.as_str());
        match e.op {
            EntryOp::Create | EntryOp::KeepBoth => {
                if ours {
                    if std::fs::remove_file(&target).is_ok() {
                        report.removed += 1;
                        prune_empty_parents(&target, &root_dir);
                    }
                } else if current.is_some() {
                    report.kept_modified.push(target);
                }
            }
            EntryOp::Update | EntryOp::Overwrite => {
                let restorable = e.backup.as_ref().and_then(|b| store.resolve(&b.rel).ok()).filter(|p| p.is_file());
                if ours || current.is_none() {
                    match restorable {
                        Some(bak) => {
                            if std::fs::read(&bak).ok().is_some_and(|bytes| fsx::write_atomic(&target, &bytes).is_ok())
                            {
                                report.restored += 1;
                            }
                        }
                        None => {
                            if ours && std::fs::remove_file(&target).is_ok() {
                                report.removed += 1;
                                prune_empty_parents(&target, &root_dir);
                            }
                        }
                    }
                } else {
                    report.kept_modified.push(target);
                }
            }
        }
    }
    report
}

/// Pfade, die andere aktive Einrichtungen ebenfalls anlegten oder anmeldeten. Frühere Einrichtungen desselben Pakets im
/// selben Bereich zählen nicht: Beim Zurücknehmen soll deren Stand ja wiederhergestellt werden.
fn paths_needed_elsewhere(store: &SetupStore, current: &Manifest) -> BTreeSet<PathBuf> {
    let mut out = BTreeSet::new();
    for m in store.list_manifests().iter().filter(|m| {
        m.setup_id != current.setup_id
            && m.status != ManifestStatus::Undone
            && !(m.pack_id == current.pack_id && m.scope_id == current.scope_id)
    }) {
        for e in &m.entries {
            if let Some(p) = target_of(&m.roots, e.root, &e.rel) {
                out.insert(p);
            }
        }
        for f in &m.fonts {
            if let Some(p) = target_of(&m.roots, f.root, &f.rel) {
                out.insert(p);
            }
        }
    }
    out
}

/// Nimmt eine Einrichtung zurück. Nur die jüngste, nicht zurückgenommene Einrichtung eines Bereichs ist zurücknehmbar.
pub fn undo(setup_id: &str, store: &SetupStore, fonts: &dyn FontInstaller) -> Result<UndoReport, SetupError> {
    let mut manifest = store.load_manifest(setup_id)?.ok_or_else(|| SetupError::NotFound(setup_id.to_owned()))?;
    if manifest.status == ManifestStatus::Undone {
        return Err(SetupError::InvalidInput {
            field: "setupId".into(),
            reason: "Diese Einrichtung ist schon zurückgenommen".into(),
        });
    }
    let latest = latest_manifest(store, &manifest.pack_id, &manifest.scope_id);
    if latest.as_ref().map(|m| m.setup_id.as_str()) != Some(setup_id) {
        return Err(SetupError::InvalidInput {
            field: "setupId".into(),
            reason: "Nur die jüngste Einrichtung dieses Bereichs lässt sich zurücknehmen".into(),
        });
    }
    let keep = paths_needed_elsewhere(store, &manifest);
    let report = rollback(store, fonts, &manifest.roots, &manifest.entries, &manifest.fonts, &keep);
    manifest.status = ManifestStatus::Undone;
    manifest.undone_at = Some(now_iso());
    store.save_manifest(&manifest)?;
    store.remove_backups(setup_id);
    Ok(UndoReport {
        setup_id: setup_id.to_owned(),
        restored: report.restored,
        removed: report.removed,
        kept_modified: report.kept_modified.iter().map(|p| display_path(p)).collect(),
        fonts_removed: report.fonts_removed,
    })
}

/// Rollt offene Journale zurück (App-Start nach Absturz). Gibt die Zahl der aufgeräumten Einrichtungen zurück.
pub fn recover(store: &SetupStore, fonts: &dyn FontInstaller) -> usize {
    let mut count = 0;
    for j in store.list_journals() {
        if j.state == JournalState::Applying {
            rollback(store, fonts, &j.roots, &j.entries, &j.fonts, &BTreeSet::new());
            let _ = std::fs::remove_file(store.manifest_path(&j.setup_id));
            store.remove_backups(&j.setup_id);
            tracing::warn!("Einrichtung {} nach Abbruch zurückgerollt", j.setup_id);
            count += 1;
        }
        store.remove_journal(&j.setup_id);
    }
    count
}

// ---------------------------------------------------------------------------------------------
// Verlauf und Zustand
// ---------------------------------------------------------------------------------------------

/// Verlauf eines Bereichs, neueste zuerst.
pub fn history(pack_id: &str, scope_id: &str, store: &SetupStore) -> Vec<SetupRecord> {
    let all: Vec<Manifest> =
        store.list_manifests().into_iter().filter(|m| m.pack_id == pack_id && m.scope_id == scope_id).collect();
    let latest_active = all.iter().rev().find(|m| m.status != ManifestStatus::Undone).map(|m| m.setup_id.clone());
    all.iter().rev().map(|m| record_of(m, latest_active.as_deref() == Some(m.setup_id.as_str()))).collect()
}

fn status_of(pack: &PackManifest, scope: &ResolvedScope, latest: Option<&Manifest>) -> SetupStatus {
    if scope.unsupported.is_some() {
        return SetupStatus::Unsupported;
    }
    let Some(m) = latest else { return SetupStatus::NotApplied };
    if m.status == ManifestStatus::Partial {
        return SetupStatus::Partial;
    }
    match (semver::Version::parse(&m.pack_version), semver::Version::parse(&pack.version)) {
        (Ok(applied), Ok(current)) if applied < current => SetupStatus::Outdated,
        _ => SetupStatus::Applied,
    }
}

/// Zustand eines Pakets in allen Bereichen (für Programme und Einstellungen). Rechnet nichts durch: nur Manifeste lesen.
pub fn summary(pack: &PackManifest, scopes: &[ResolvedScope], store: &SetupStore) -> SetupSummary {
    let manifests = store.list_manifests();
    let scopes = scopes
        .iter()
        .map(|scope| {
            let mine: Vec<&Manifest> =
                manifests.iter().filter(|m| m.pack_id == pack.id && m.scope_id == scope.scope_id).collect();
            let latest = mine.iter().rev().find(|m| m.status != ManifestStatus::Undone).copied();
            let mut target_roots: Vec<String> = scope
                .roots
                .iter()
                .filter(|(id, _)| {
                    !matches!(id, RootId::ProjectTemplates | RootId::BlenderExtensions | RootId::BlenderScripts)
                })
                .map(|(_, p)| display_path(p))
                .collect();
            target_roots.dedup();
            SetupScope {
                scope_id: scope.scope_id.clone(),
                scope_kind: scope.kind,
                components_applied: latest.map(|m| m.components.clone()).unwrap_or_default(),
                target_roots,
                installation_ids: scope.installation_ids.clone(),
                status: status_of(pack, scope, latest),
                record: latest.map(|m| record_of(m, true)),
            }
        })
        .collect();
    SetupSummary {
        pack_id: pack.id.clone(),
        program_id: pack.program_id.clone(),
        title: pack.title.clone(),
        pack_version: pack.version.clone(),
        requires_packs: pack.requires_packs.clone(),
        scopes,
    }
}

#[allow(dead_code)]
fn _kind_is_used(_: ScopeKind) {}
