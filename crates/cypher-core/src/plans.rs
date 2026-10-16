//! Pläne mit Ablaufzeit (ARCHITEKTUR.md 2.2, L7): eine Installation oder Einrichtung wird zuerst als Plan
//! berechnet und gezeigt; ausgeführt wird genau dieser Plan, einmal, innerhalb von 10 Minuten.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Standardgültigkeit eines Plans.
pub const PLAN_TTL: Duration = Duration::from_secs(10 * 60);
/// Höchstzahl gleichzeitig gespeicherter Pläne.
pub const PLAN_MAX: usize = 20;

/// Der Plan ist abgelaufen, wurde schon verbraucht oder ist unbekannt.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("Plan `{0}` abgelaufen oder unbekannt")]
pub struct PlanExpired(pub String);

struct Entry<T> {
    id: String,
    plan: T,
    inserted: Instant,
}

pub struct PlanStore<T> {
    entries: Mutex<Vec<Entry<T>>>,
    ttl: Duration,
    max: usize,
}

impl<T> PlanStore<T> {
    pub fn new() -> Self {
        Self::with_limits(PLAN_TTL, PLAN_MAX)
    }

    pub fn with_limits(ttl: Duration, max: usize) -> Self {
        PlanStore { entries: Mutex::new(Vec::new()), ttl, max }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Entry<T>>> {
        match self.entries.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        }
    }

    /// Legt einen Plan ab. Abgelaufene fliegen heraus; bei Überfüllung der älteste.
    pub fn insert(&self, id: impl Into<String>, plan: T) {
        let mut entries = self.lock();
        entries.retain(|e| e.inserted.elapsed() < self.ttl);
        while entries.len() >= self.max {
            entries.remove(0);
        }
        entries.push(Entry { id: id.into(), plan, inserted: Instant::now() });
    }

    /// Nimmt den Plan heraus (einmal verwendbar).
    pub fn take(&self, id: &str) -> Result<T, PlanExpired> {
        let mut entries = self.lock();
        entries.retain(|e| e.inserted.elapsed() < self.ttl);
        match entries.iter().position(|e| e.id == id) {
            Some(i) => Ok(entries.remove(i).plan),
            None => Err(PlanExpired(id.to_owned())),
        }
    }

    /// Liest den Plan, ohne ihn zu verbrauchen.
    pub fn peek<R>(&self, id: &str, f: impl FnOnce(&T) -> R) -> Option<R> {
        let mut entries = self.lock();
        entries.retain(|e| e.inserted.elapsed() < self.ttl);
        entries.iter().find(|e| e.id == id).map(|e| f(&e.plan))
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl<T> Default for PlanStore<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_are_single_use() {
        let store = PlanStore::new();
        store.insert("a", 1);
        assert_eq!(store.peek("a", |p| *p), Some(1));
        assert_eq!(store.take("a"), Ok(1));
        assert_eq!(store.take("a"), Err(PlanExpired("a".into())));
        assert_eq!(store.take("unbekannt"), Err(PlanExpired("unbekannt".into())));
    }

    #[test]
    fn plans_expire() {
        let store = PlanStore::with_limits(Duration::from_millis(20), 20);
        store.insert("a", 1);
        std::thread::sleep(Duration::from_millis(40));
        assert_eq!(store.take("a"), Err(PlanExpired("a".into())));
        assert!(store.is_empty());
    }

    #[test]
    fn the_oldest_plan_makes_room() {
        let store = PlanStore::with_limits(PLAN_TTL, 3);
        for i in 0..5 {
            store.insert(format!("p{i}"), i);
        }
        assert_eq!(store.len(), 3);
        assert!(store.take("p0").is_err() && store.take("p1").is_err());
        assert_eq!(store.take("p4"), Ok(4));
    }
}
