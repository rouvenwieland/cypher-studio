/** Bibliothek und gemeinsamer Ordner (CONCEPT.md 6.7, DESIGN.md §7 „Bibliothek“). */
import type { LibraryKind, SyncTool } from "@contract";

export const library = {
  title: "Bibliothek",
  searchPlaceholder: (n: string) => `Suchen in ${n} Dateien`,
  searchLabel: "Dateien durchsuchen",
  changeFolder: "Ordner wechseln",
  chooseFolder: "Ordner wählen",
  view: { label: "Ansicht", grid: "Raster", list: "Liste" },
  sort: { label: "Sortierung", modifiedDesc: "Geändert", nameAsc: "Name", kind: "Art", sizeDesc: "Größe" },
  filters: {
    title: "Filter",
    kind: "Art",
    collection: "Kollektion",
    tags: "Tags",
    period: "Zeitraum",
    active: "Aktive Filter",
    clear: "Alle Filter lösen",
    removeFilter: (name: string) => `Filter „${name}“ lösen`,
    period7: "letzte 7 Tage",
    period30: "letzte 30 Tage",
    period365: "letztes Jahr",
    conflicts: "Konfliktkopien",
    noTags: "Noch keine Tags",
    moreTags: "weitere Tags",
  },
  kinds: {
    image: "Bild",
    vector: "Vektor",
    model3d: "3D",
    video: "Video",
    audio: "Ton",
    font: "Schrift",
    palette: "Palette",
    document: "Dokument",
    other: "Sonstiges",
  } satisfies Record<LibraryKind, string>,
  grid: {
    label: "Dateien",
    count: (shown: string, total: string) => `${shown} von ${total} Dateien`,
    typeAndSize: (type: string, size: string) => `${type} · ${size}`,
    conflictBadge: "Konfliktkopie",
    noPreview: "Keine Vorschau",
    selected: (name: string) => `${name}, ausgewählt`,
    selectedCount: (n: number) => (n === 1 ? "1 ausgewählt" : `${n} ausgewählt`),
    scanning: (done: string, total: string) => `Lese ${done} von ${total}`,
    loadMore: "Weitere werden geladen",
  },
  listColumns: {
    name: "Name",
    kind: "Art",
    collection: "Kollektion",
    tags: "Tags",
    modified: "Geändert",
    size: "Größe",
  },
  multi: {
    setTags: "Tags setzen",
    collection: "Kollektion",
    checkPrint: "Im Druck prüfen",
    reveal: "Im Ordner zeigen",
    clear: "Auswahl aufheben",
    addTagPlaceholder: "Tag hinzufügen",
    addTag: "Hinzufügen",
    removeTag: "Entfernen",
    applied: (n: number) => `Gespeichert für ${n} ${n === 1 ? "Datei" : "Dateien"}`,
    tagsTitle: "Tags setzen",
    tagsHelp: "Neue Tags kommen zu den vorhandenen dazu. Mehrere trennst du mit Komma oder Leerzeichen.",
    noCollection: "ohne Kollektion",
  },
  inspector: {
    title: "Datei",
    empty: "Wähle eine Datei, dann siehst du hier Vorschau, Maße und Aktionen.",
    preview: "Vorschau",
    facts: {
      path: "Pfad",
      size: "Größe",
      dimensions: "Maße",
      modified: "Geändert",
      project: "Projekt",
      author: "Autor",
      status: "Status",
    },
    status: { draft: "Entwurf", approved: "Freigegeben", archived: "Archiviert" },
    tags: "Tags",
    addTag: "Tag hinzufügen",
    tagPlaceholder: "neuer Tag",
    tagSaved: "Gespeichert",
    removeTag: (tag: string) => `Tag „${tag}“ entfernen`,
    openIn: (program: string) => `In ${program} öffnen`,
    openDefault: "Öffnen",
    checkPrint: "Im Druck prüfen",
    mockup: "Mockup erzeugen",
    social: "Als Social-Bild",
    cutout: "Freistellen",
    reveal: "Im Ordner zeigen",
    conflictTitle: "Konfliktkopie",
    conflictText: (orig: string | null) =>
      orig
        ? `Das Sync-Programm hat diese Kopie neben ${orig} angelegt. Vergleiche beide, bevor du eine löschst.`
        : "Das Sync-Programm hat diese Kopie angelegt. Vergleiche sie mit dem Original, bevor du eine löschst.",
    sidecarMissing: "Noch keine Begleitdatei. Sie entsteht beim ersten Bearbeiten.",
    readOnly: "Die Begleitdatei lässt sich nicht schreiben. Tags sind nur lesbar.",
    noThumb: (ext: string) => `${ext.toUpperCase()} ohne eingebettetes Vorschaubild`,
  },
  empty: {
    noFolder: {
      title: "Noch kein gemeinsamer Ordner",
      text: "Wähle den Ordner, den ihr teilt, dann erscheinen hier eure Dateien.",
    },
    noMatch: (terms: string) => `Keine Datei passt zu ${terms}.`,
    clearFilters: "Filter lösen",
    folderLost: (path: string) => `${path} ist gerade nicht erreichbar. Deine Dateien sind nicht betroffen.`,
    retry: "Erneut versuchen",
    other: "Anderen Ordner wählen",
    emptyFolder: "In diesem Ordner liegt noch nichts, das Cypher Studio kennt.",
  },
  quick: { title: "Schnellansicht", close: "Schließen", previous: "Vorherige Datei", next: "Nächste Datei" },
  chooseRoot: {
    title: "Gemeinsamen Ordner wählen",
    working: "Der Ordner wird gelesen …",
    summary: (files: string, size: string, projects: string) =>
      `${files} Dateien · ${size} · ${projects} Projekte gefunden`,
    sync: (tool: SyncTool | null) => {
      switch (tool) {
        case "syncthing":
          return "Erkannt: Syncthing";
        case "nextcloud":
          return "Erkannt: Nextcloud";
        case "dropbox":
          return "Erkannt: Dropbox";
        case "googleDrive":
          return "Erkannt: Google Drive";
        case "oneDrive":
          return "Erkannt: OneDrive";
        case "iCloud":
          return "Erkannt: iCloud Drive";
        case "unknown":
        case null:
          return "Kein Sync-Programm erkannt";
      }
    },
    hint: "Cypher Studio synchronisiert nicht selbst. Nutzt einen Ordner von Syncthing, Nextcloud oder einem ähnlichen Dienst.",
    use: "Diesen Ordner nutzen",
    initialize: "Cypher-Struktur anlegen (.cypher und Standardordner)",
    problems: {
      notWritable: "In diesen Ordner darf Cypher Studio nicht schreiben.",
      insideAppData: "Der Ordner liegt im Programmdatenordner von Cypher Studio.",
      systemDirectory: "Systemordner sind als gemeinsamer Ordner gesperrt.",
      veryLarge: "Der Ordner ist sehr groß. Das erste Lesen kann etwas dauern.",
    },
    cancelled: "Kein Ordner gewählt.",
    done: (path: string) => `Gemeinsamer Ordner: ${path}`,
  },
} as const;
