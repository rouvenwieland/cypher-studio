//! Fortschritt ohne Tauri: der Kern sendet Ereignisse an einen `ProgressSink`, die Tauri-Schicht
//! adaptiert ihn auf `tauri::ipc::Channel`.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Empfänger für Fortschrittsereignisse. Fehler beim Senden werden vom Empfänger geloggt, nie weitergereicht.
pub trait ProgressSink<E>: Send + Sync {
    fn emit(&self, event: E);
}

impl<E, F: Fn(E) + Send + Sync> ProgressSink<E> for F {
    fn emit(&self, event: E) {
        self(event)
    }
}

/// Wirft alle Ereignisse weg (Tests, CLI ohne Anzeige).
pub struct NoProgress;

impl<E> ProgressSink<E> for NoProgress {
    fn emit(&self, _event: E) {}
}

/// Sammelt Ereignisse (Tests).
pub struct Collect<E>(Mutex<Vec<E>>);

impl<E> Collect<E> {
    pub fn new() -> Self {
        Collect(Mutex::new(Vec::new()))
    }

    /// Alle bisher gesammelten Ereignisse.
    pub fn take(&self) -> Vec<E> {
        match self.0.lock() {
            Ok(mut guard) => std::mem::take(&mut *guard),
            Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
        }
    }
}

impl<E> Default for Collect<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: Send> ProgressSink<E> for Collect<E> {
    fn emit(&self, event: E) {
        match self.0.lock() {
            Ok(mut guard) => guard.push(event),
            Err(poisoned) => poisoned.into_inner().push(event),
        }
    }
}

/// Drosselt Fortschrittsereignisse (Standard: höchstens 10 pro Sekunde). Ereignisse, für die `important`
/// `true` liefert (Start, Ende, Phasenwechsel), gehen immer durch.
pub struct Throttled<'a, E> {
    inner: &'a dyn ProgressSink<E>,
    min_interval: Duration,
    last: Mutex<Option<Instant>>,
    important: fn(&E) -> bool,
}

impl<'a, E> Throttled<'a, E> {
    pub fn new(inner: &'a dyn ProgressSink<E>, important: fn(&E) -> bool) -> Self {
        Self::with_interval(inner, Duration::from_millis(100), important)
    }

    pub fn with_interval(inner: &'a dyn ProgressSink<E>, min_interval: Duration, important: fn(&E) -> bool) -> Self {
        Throttled { inner, min_interval, last: Mutex::new(None), important }
    }
}

impl<E: Send> ProgressSink<E> for Throttled<'_, E> {
    fn emit(&self, event: E) {
        let pass = (self.important)(&event) || {
            let mut last = match self.last.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            let due = last.is_none_or(|t| t.elapsed() >= self.min_interval);
            if due {
                *last = Some(Instant::now());
            }
            due
        };
        if pass {
            self.inner.emit(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_drops_fast_events_but_keeps_important_ones() {
        let sink = Collect::<u32>::new();
        let throttled = Throttled::with_interval(&sink, Duration::from_secs(60), |e| *e >= 100);
        for i in 0..50 {
            throttled.emit(i);
        }
        throttled.emit(100);
        throttled.emit(101);
        assert_eq!(sink.take(), vec![0, 100, 101]);
    }

    #[test]
    fn closures_are_sinks() {
        let counter = std::sync::atomic::AtomicU32::new(0);
        let f = |_: u8| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        };
        ProgressSink::emit(&f, 1u8);
        assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
