//! Aufträge (Jobs): laufende Vorgänge mit Abbruch, Konfliktschlüssel und Verlauf der letzten 24 Stunden
//! (ARCHITEKTUR.md 2.2). Speist das Popover „Aufträge“ über `jobs:changed`.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::api::{AppError, BusyReason, JobId, JobInfo, JobKind, JobOutcome, JobRecord, JobResult, JobsChanged};
use crate::error::{BusyInfo, CoreError};
use crate::platform::fsx;
use crate::util::{new_id, now_iso, parse_iso};

const HISTORY_MAX: usize = 200;
const HISTORY_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);

struct ActiveJob {
    info: JobInfo,
    conflict_key: String,
    token: CancellationToken,
    last_emit: Option<Instant>,
}

struct State {
    active: Vec<ActiveJob>,
    history: VecDeque<JobRecord>,
}

struct Inner {
    state: Mutex<State>,
    on_change: Box<dyn Fn(JobsChanged) + Send + Sync>,
    history_path: Option<PathBuf>,
}

/// Verwaltet laufende und abgeschlossene Aufträge. Klonen ist billig (gemeinsamer Zustand).
#[derive(Clone)]
pub struct JobRegistry {
    inner: Arc<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

impl JobRegistry {
    /// `history_path`: JSON-Datei für den Verlauf (`None` = nur im Speicher). `on_change` wird bei jedem Start, Fortschritt
    /// (höchstens 2 pro Sekunde und Auftrag) und Ende aufgerufen.
    pub fn new(history_path: Option<PathBuf>, on_change: impl Fn(JobsChanged) + Send + Sync + 'static) -> Self {
        let mut history: VecDeque<JobRecord> = history_path
            .as_deref()
            .and_then(|p| fsx::read_json::<Vec<JobRecord>>(p).ok().flatten())
            .unwrap_or_default()
            .into();
        prune(&mut history);
        JobRegistry {
            inner: Arc::new(Inner {
                state: Mutex::new(State { active: Vec::new(), history }),
                on_change: Box::new(on_change),
                history_path,
            }),
        }
    }

    /// Startet einen Auftrag. `Busy`, wenn bereits einer mit demselben Konfliktschlüssel läuft
    /// (`install:<programId>`, `setup:<packId>:<scopeId>`, `library:*`, `appUpdate`).
    pub fn start(
        &self,
        kind: JobKind,
        subject: &str,
        conflict_key: &str,
        cancellable: bool,
    ) -> Result<JobGuard, CoreError> {
        let (id, token, snapshot) = {
            let mut state = lock(&self.inner.state);
            if let Some(running) = state.active.iter().find(|j| j.conflict_key == conflict_key) {
                return Err(CoreError::Busy(BusyInfo {
                    reason: BusyReason::JobRunning,
                    job_id: Some(running.info.id.clone()),
                }));
            }
            let id = new_id();
            let token = CancellationToken::new();
            state.active.push(ActiveJob {
                info: JobInfo {
                    id: id.clone(),
                    kind,
                    subject: subject.to_owned(),
                    started_at: now_iso(),
                    cancellable,
                    progress: None,
                    phase: None,
                    needs_attention: false,
                },
                conflict_key: conflict_key.to_owned(),
                token: token.clone(),
                last_emit: None,
            });
            (id, token, state.active.iter().map(|j| j.info.clone()).collect::<Vec<_>>())
        };
        (self.inner.on_change)(JobsChanged { active: snapshot, finished: None });
        Ok(JobGuard { registry: self.clone(), id, token, done: false })
    }

    /// Bricht einen Auftrag ab (nur wenn er abbrechbar ist). `true`, wenn der Auftrag existiert und abbrechbar war.
    pub fn cancel(&self, id: &str) -> bool {
        let state = lock(&self.inner.state);
        match state.active.iter().find(|j| j.info.id == id) {
            Some(job) if job.info.cancellable => {
                job.token.cancel();
                true
            }
            _ => false,
        }
    }

    /// Bricht alle abbrechbaren Aufträge ab (Fenster schließen).
    pub fn cancel_all(&self) -> usize {
        let state = lock(&self.inner.state);
        state.active.iter().filter(|j| j.info.cancellable).map(|j| j.token.cancel()).count()
    }

    pub fn active(&self) -> Vec<JobInfo> {
        lock(&self.inner.state).active.iter().map(|j| j.info.clone()).collect()
    }

    /// Abgeschlossene Aufträge der letzten 24 Stunden, neueste zuerst.
    pub fn recent(&self) -> Vec<JobRecord> {
        let mut state = lock(&self.inner.state);
        prune(&mut state.history);
        state.history.iter().cloned().collect()
    }

    fn finish_inner(&self, id: &str, outcome: JobOutcome, error: Option<AppError>, result: JobResult) {
        let (record, active) = {
            let mut state = lock(&self.inner.state);
            let Some(pos) = state.active.iter().position(|j| j.info.id == id) else { return };
            let mut job = state.active.remove(pos);
            job.info.progress = if outcome == JobOutcome::Succeeded { Some(1.0) } else { job.info.progress };
            job.info.needs_attention = false;
            let record = JobRecord { info: job.info, finished_at: now_iso(), outcome, error, result };
            state.history.push_front(record.clone());
            prune(&mut state.history);
            if let Some(path) = &self.inner.history_path {
                let all: Vec<&JobRecord> = state.history.iter().collect();
                if let Err(e) = fsx::write_json_atomic(path, &all) {
                    tracing::warn!("Auftragsverlauf nicht gespeichert: {e}");
                }
            }
            (record, state.active.iter().map(|j| j.info.clone()).collect::<Vec<_>>())
        };
        (self.inner.on_change)(JobsChanged { active, finished: Some(record) });
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut JobInfo), throttle: bool) {
        let snapshot = {
            let mut state = lock(&self.inner.state);
            let Some(job) = state.active.iter_mut().find(|j| j.info.id == id) else { return };
            f(&mut job.info);
            if throttle {
                if job.last_emit.is_some_and(|t| t.elapsed() < PROGRESS_INTERVAL) {
                    return;
                }
                job.last_emit = Some(Instant::now());
            }
            state.active.iter().map(|j| j.info.clone()).collect::<Vec<_>>()
        };
        (self.inner.on_change)(JobsChanged { active: snapshot, finished: None });
    }
}

fn prune(history: &mut VecDeque<JobRecord>) {
    let now = time::OffsetDateTime::now_utc();
    history
        .retain(|r| parse_iso(&r.finished_at).is_none_or(|t| (now - t).unsigned_abs() <= HISTORY_MAX_AGE || t > now));
    history.truncate(HISTORY_MAX);
}

/// Handle eines laufenden Auftrags. Endet er ohne `finish*` (Panik, früher Rückkehrfehler), wird er als
/// fehlgeschlagen verbucht.
pub struct JobGuard {
    registry: JobRegistry,
    pub id: JobId,
    pub token: CancellationToken,
    done: bool,
}

impl JobGuard {
    /// Fortschritt 0..1 (`None` = unbestimmt) und Phasencode, gedrosselt auf 2 Meldungen pro Sekunde.
    pub fn progress(&self, fraction: Option<f64>, phase: &'static str) {
        self.registry.update(
            &self.id,
            |info| {
                info.progress = fraction.map(|f| f.clamp(0.0, 1.0));
                info.phase = Some(phase.to_owned());
            },
            true,
        );
    }

    /// Bernstein-Lampe: der Auftrag wartet auf den Nutzer.
    pub fn needs_attention(&self, yes: bool) {
        self.registry.update(&self.id, |info| info.needs_attention = yes, false);
    }

    pub fn finish_ok(mut self, result: JobResult) {
        self.done = true;
        self.registry.finish_inner(&self.id, JobOutcome::Succeeded, None, result);
    }

    /// Verbucht einen Fehler; `AppError::Cancelled` wird als „abgebrochen“ gezählt.
    pub fn finish_err(mut self, error: AppError) {
        self.done = true;
        let outcome = if matches!(error, AppError::Cancelled) { JobOutcome::Cancelled } else { JobOutcome::Failed };
        self.registry.finish_inner(&self.id, outcome, Some(error), JobResult::None);
    }

    /// Abkürzung: `Ok` → Erfolg mit `result(&wert)`, `Err` → Fehler.
    pub fn finish<T, E: Into<AppError>>(self, outcome: Result<&T, E>, result: impl FnOnce(&T) -> JobResult) {
        match outcome {
            Ok(value) => {
                let r = result(value);
                self.finish_ok(r)
            }
            Err(e) => self.finish_err(e.into()),
        }
    }
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if !self.done {
            self.registry.finish_inner(
                &self.id,
                JobOutcome::Failed,
                Some(AppError::internal("Auftrag unvollständig beendet")),
                JobResult::None,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn registry(path: Option<PathBuf>) -> (JobRegistry, Arc<Mutex<Vec<JobsChanged>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        (JobRegistry::new(path, move |e| lock(&sink).push(e)), events)
    }

    #[test]
    fn conflicting_jobs_are_busy() {
        let (reg, _) = registry(None);
        let first = reg.start(JobKind::Install, "Blender", "install:blender", true).unwrap();
        match reg.start(JobKind::Install, "Blender", "install:blender", true) {
            Err(CoreError::Busy(info)) => assert_eq!(info.job_id.as_deref(), Some(first.id.as_str())),
            other => panic!("erwartet Busy, erhalten {:?}", other.map(|g| g.id.clone())),
        }
        // anderer Schlüssel läuft parallel
        let second = reg.start(JobKind::Install, "Krita", "install:krita", true).unwrap();
        assert_eq!(reg.active().len(), 2);
        first.finish_ok(JobResult::None);
        second.finish_ok(JobResult::None);
        assert!(reg.start(JobKind::Install, "Blender", "install:blender", true).is_ok());
    }

    #[test]
    fn finish_records_history_and_notifies() {
        let (reg, events) = registry(None);
        let guard = reg.start(JobKind::Install, "Blender 5.2.2", "install:blender", true).unwrap();
        guard.progress(Some(0.5), "download");
        guard.finish_ok(JobResult::Installation { installation_id: "cypher:blender:5.2.2".into() });
        let recent = reg.recent();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].outcome, JobOutcome::Succeeded);
        assert_eq!(recent[0].info.progress, Some(1.0));
        let events = lock(&events);
        assert!(events.first().unwrap().finished.is_none(), "Start meldet nur die aktiven Aufträge");
        assert!(events.last().unwrap().finished.is_some());
        assert!(events.last().unwrap().active.is_empty());
    }

    #[test]
    fn cancel_flips_the_token_only_for_cancellable_jobs() {
        let (reg, _) = registry(None);
        let a = reg.start(JobKind::Install, "A", "a", true).unwrap();
        let b = reg.start(JobKind::LibraryScan, "B", "b", false).unwrap();
        assert!(reg.cancel(&a.id));
        assert!(a.token.is_cancelled());
        assert!(!reg.cancel(&b.id));
        assert!(!b.token.is_cancelled());
        assert!(!reg.cancel("unbekannt"));
        a.finish_err(AppError::Cancelled);
        assert_eq!(reg.recent()[0].outcome, JobOutcome::Cancelled);
    }

    #[test]
    fn dropping_a_guard_records_a_failure() {
        let (reg, _) = registry(None);
        drop(reg.start(JobKind::Install, "A", "a", true).unwrap());
        assert!(reg.active().is_empty());
        assert_eq!(reg.recent()[0].outcome, JobOutcome::Failed);
    }

    #[test]
    fn progress_events_are_throttled() {
        let counter = Arc::new(AtomicUsize::new(0));
        let c = counter.clone();
        let reg = JobRegistry::new(None, move |_| {
            c.fetch_add(1, Ordering::SeqCst);
        });
        let guard = reg.start(JobKind::Install, "A", "a", true).unwrap();
        for i in 0..100 {
            guard.progress(Some(f64::from(i) / 100.0), "download");
        }
        // 1 (Start) + höchstens ein gedrosseltes Fortschrittsereignis
        assert!(counter.load(Ordering::SeqCst) <= 3, "{}", counter.load(Ordering::SeqCst));
        guard.finish_ok(JobResult::None);
    }

    #[test]
    fn history_persists_and_is_pruned() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs-history.json");
        {
            let (reg, _) = registry(Some(path.clone()));
            reg.start(JobKind::Install, "A", "a", true).unwrap().finish_ok(JobResult::None);
        }
        let (reg, _) = registry(Some(path.clone()));
        assert_eq!(reg.recent().len(), 1);

        // älter als 24 h fällt heraus
        let mut records: Vec<JobRecord> = fsx::read_json(&path).unwrap().unwrap();
        records[0].finished_at = "2020-01-01T00:00:00Z".to_owned();
        fsx::write_json_atomic(&path, &records).unwrap();
        let (reg, _) = registry(Some(path));
        assert!(reg.recent().is_empty());
    }
}
