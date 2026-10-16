//! Dateien, die das Frontend nur über Handles kennt (ARCHITEKTUR.md 2.17): nie Pfade über die Grenze.
//!
//! Ein Handle gilt für die Sitzung (nicht gespeichert) und verweist auf einen Pfad. Es werden höchstens 1000 gehalten
//! (die ältesten fallen heraus).

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::api::{FileHandleInfo, HandleSource};
use crate::error::IoError;
use crate::library::model::{extension_of, mime_of};
use crate::platform::display_path;
use crate::urls;
use crate::util::new_id;

pub const MAX_HANDLES: usize = 1000;

#[derive(Debug, Clone)]
struct Handle {
    path: PathBuf,
    source: HandleSource,
}

#[derive(Default)]
struct Inner {
    map: HashMap<String, Handle>,
    order: VecDeque<String>,
}

pub struct HandleRegistry {
    inner: Mutex<Inner>,
}

/// MIME-Typ aus dem Inhalt (Magic Bytes), sonst nach Endung.
pub fn sniff_mime(path: &Path) -> String {
    let mut head = [0u8; 8192];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    if let Some(kind) = infer::get(&head[..n]) {
        return kind.mime_type().to_owned();
    }
    mime_of(&extension_of(&path.to_string_lossy())).to_owned()
}

/// Bilder, die `cyfile` ausliefert (SVG nie; TIFF als PNG-Vorschau).
pub fn is_servable_image(mime: &str) -> bool {
    matches!(mime, "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/tiff")
}

impl HandleRegistry {
    pub fn new() -> Self {
        HandleRegistry { inner: Mutex::new(Inner::default()) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        }
    }

    fn info_of(id: &str, h: &Handle) -> Result<FileHandleInfo, IoError> {
        let md = std::fs::metadata(&h.path).map_err(|e| IoError::read(&h.path, e))?;
        let mime = sniff_mime(&h.path);
        let url = is_servable_image(&mime).then(|| urls::url("cyfile", id));
        Ok(FileHandleInfo {
            id: id.to_owned(),
            name: h.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            display_path: display_path(&h.path),
            size: md.len(),
            mime,
            url,
            source: h.source,
        })
    }

    /// Meldet eine Datei an und gibt ihr Handle zurück.
    pub fn register(&self, path: &Path, source: HandleSource) -> Result<FileHandleInfo, IoError> {
        let handle = Handle { path: path.to_path_buf(), source };
        let id = new_id();
        let info = Self::info_of(&id, &handle)?;
        let mut inner = self.lock();
        inner.map.insert(id.clone(), handle);
        inner.order.push_back(id);
        while inner.order.len() > MAX_HANDLES {
            if let Some(old) = inner.order.pop_front() {
                inner.map.remove(&old);
            }
        }
        Ok(info)
    }

    /// Pfad zu einem Handle.
    pub fn resolve(&self, id: &str) -> Option<PathBuf> {
        self.lock().map.get(id).map(|h| h.path.clone())
    }

    /// Aktuelle Angaben zu einem Handle (Größe und Typ werden frisch gelesen).
    pub fn info(&self, id: &str) -> Option<FileHandleInfo> {
        let handle = self.lock().map.get(id).cloned()?;
        Self::info_of(id, &handle).ok()
    }

    pub fn len(&self) -> usize {
        self.lock().map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for HandleRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255])).save(&p).unwrap();
        p
    }

    #[test]
    fn register_resolve_and_info() {
        let tmp = tempfile::tempdir().unwrap();
        let reg = HandleRegistry::new();
        let p = png(tmp.path(), "bild.png");
        let h = reg.register(&p, HandleSource::Dialog).unwrap();
        assert_eq!(h.name, "bild.png");
        assert_eq!(h.mime, "image/png");
        assert!(h.url.as_deref().is_some_and(|u| u.contains("cyfile") && u.ends_with(&h.id)));
        assert_eq!(h.source, HandleSource::Dialog);
        assert_eq!(reg.resolve(&h.id), Some(p));
        assert_eq!(reg.info(&h.id).unwrap().size, h.size);
        assert!(reg.resolve("gibtsnicht").is_none());
        // der Typ kommt aus dem Inhalt, nicht aus der Endung
        let fake = tmp.path().join("foto.jpg");
        std::fs::copy(tmp.path().join("bild.png"), &fake).unwrap();
        assert_eq!(reg.register(&fake, HandleSource::Drop).unwrap().mime, "image/png");
    }

    #[test]
    fn svg_and_other_files_get_no_url() {
        let tmp = tempfile::tempdir().unwrap();
        let reg = HandleRegistry::new();
        let svg = tmp.path().join("a.svg");
        std::fs::write(&svg, b"<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        let h = reg.register(&svg, HandleSource::Library).unwrap();
        assert!(h.url.is_none());
        assert_eq!(h.mime, "image/svg+xml");
        let txt = tmp.path().join("a.kra");
        std::fs::write(&txt, b"x").unwrap();
        assert!(reg.register(&txt, HandleSource::Project).unwrap().url.is_none());
    }

    #[test]
    fn missing_file_is_an_error_and_old_handles_expire() {
        let tmp = tempfile::tempdir().unwrap();
        let reg = HandleRegistry::new();
        assert!(reg.register(&tmp.path().join("fehlt.png"), HandleSource::Dialog).is_err());
        let p = png(tmp.path(), "x.png");
        let first = reg.register(&p, HandleSource::Dialog).unwrap();
        for _ in 0..MAX_HANDLES {
            reg.register(&p, HandleSource::Dialog).unwrap();
        }
        assert_eq!(reg.len(), MAX_HANDLES);
        assert!(reg.resolve(&first.id).is_none(), "das älteste Handle ist weg");
    }
}
