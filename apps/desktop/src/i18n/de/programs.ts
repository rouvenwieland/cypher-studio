/** Programme, Installationsdialog, Einrichtung (CONCEPT.md 6.1–6.3, DESIGN.md §7). */
import type { InstallNote, ProgramCategory } from "@contract";

export const programs = {
  title: "Programme",
  detailTitle: (name: string) => name,
  breadcrumb: (name: string) => `Programme / ${name}`,
  checkUpdates: "Nach Updates suchen",
  checking: "prüft …",
  footnote: "Alle Programme kommen unverändert aus ihren offiziellen Quellen.",
  trademarks: "Markenhinweise",
  linksTitle: "Nur Verweis",
  roles: {
    krita: "Malen · Foto",
    inkscape: "Vektor · Druck",
    blender: "3D",
    kdenlive: "Video",
  } as Record<string, string>,
  categoryRole: {
    raster: "Foto",
    vector: "Vektor",
    "3d": "3D",
    video: "Video",
    audio: "Ton",
    upscale: "Hochskalieren",
    other: "Programm",
  } satisfies Record<ProgramCategory, string>,
  status: {
    notInstalled: "nicht installiert",
    downloading: "wird geladen",
    verifying: "wird geprüft",
    installing: "wird installiert",
    installed: "installiert",
    checksumOk: "stimmte beim Laden",
    setUp: "eingerichtet",
    updateAvailable: "Update verfügbar",
    found: "gefunden",
    error: "Fehler",
    loading: "wird geprüft",
  },
  foundHint: (version: string, path: string) => `Gefunden: ${version} in ${path}`,
  foundWhy: "Außerhalb von Cypher Studio installiert: Starten und Einrichten gehen, Aktualisieren nicht.",
  actions: {
    install: "Installieren",
    update: "Aktualisieren",
    launch: "Starten",
    cancel: "Abbrechen",
    setup: "Einrichten",
    retry: "Erneut prüfen",
    details: "Details",
  },
  launchedToast: (name: string) => `${name} wird gestartet.`,
  launchFailed: (name: string) => `${name} ließ sich nicht starten.`,
  progress: {
    loadingPct: (pct: number) => `lädt ${pct} %`,
    of: (done: string, total: string) => `${done} / ${total}`,
    percent: (pct: number) => `${pct} %`,
  },
  list: {
    label: "Programme",
    selectHint: "Pfeiltasten wählen, Enter öffnet, Strg+Enter führt die Aktion aus.",
  },
  /** Warnung nur bei abgelaufenem Katalog; ein eingebauter oder gespeicherter, gültiger Katalog reicht zum Installieren. */
  catalogExpired: {
    title: "Der Programm-Katalog ist abgelaufen",
    text: "Installierte Programme laufen weiter. Neuere Versionen kennen wir erst, wenn eine Online-Prüfung gelungen ist.",
    retry: "Online prüfen",
  },
  /** Ruhige Zeile unter der Tafel: woher die Versionen stammen. */
  catalogLine: (date: string, source: "remote" | "cache" | "embedded") =>
    `Programm-Katalog vom ${date} (${{ remote: "online geladen", cache: "zuletzt online geladen", embedded: "eingebaut" }[source]})`,
  /** Version, die der Katalog für ein noch nicht installiertes Programm bereithält. */
  availableVersion: (version: string) => `${version} verfügbar`,
  detail: {
    tabs: { overview: "Übersicht", setup: "Einrichtung", history: "Verlauf" },
    tabsLabel: "Bereiche des Programms",
    back: "Zurück zu den Programmen",
    notFound: "Dieses Programm gibt es nicht.",
    menuReveal: "Im Ordner zeigen",
    menuRemove: "Deinstallieren …",
    menuForget: "Aus der Liste entfernen",
    menuHomepage: "Webseite des Programms",
    menuReleaseNotes: "Neuigkeiten der Version",
    menuLicense: "Lizenztext",
    useCase: {
      krita: "Motive malen, Fotos bearbeiten, Druckdateien als PNG ausgeben.",
      inkscape: "Vektormotive zeichnen und Druckvorlagen in Millimetern anlegen.",
      blender: "3D-Szenen bauen und Mockup-Grundbilder rendern.",
      kdenlive: "Reels schneiden und Titel mit den Cypher-Schriften setzen.",
    } as Record<string, string>,
    lastFiles: "Zuletzt in diesem Programm",
    noFiles: "In der Bibliothek liegt noch keine Datei für dieses Programm.",
    updateRow: (current: string, latest: string) => `Update: ${current} → ${latest}`,
    upToDate: "Aktuell",
    notInstalled: "Noch nicht installiert.",
    installations: "Installationen",
    preferred: "bevorzugt",
    makePreferred: "Als bevorzugt wählen",
    kind: {
      cypher: "Von Cypher Studio",
      system: "Außerhalb von Studio",
      flatpak: "Flatpak",
      snap: "Snap",
      msstore: "Microsoft Store",
      steam: "Steam",
      manual: "Von Hand hinzugefügt",
    },
    problems: {
      executableMissing: "Das Programm fehlt am angegebenen Ort.",
      fuseMissing: "FUSE fehlt: Das Programm wird entpackt und von dort gestartet.",
      notNotarized: "macOS prüft dieses Programm nicht vorab. Der erste Start braucht deine Bestätigung.",
      versionUnknown: "Die Version ließ sich nicht lesen.",
      setupNotSupported: "Einrichten geht für diese Installation nicht.",
      staleCatalogVersion: (latest: string) => `Neuere Version ${latest} ist geprüft und verfügbar.`,
      endOfSupportSoon: (until: string) => `Wird nur noch bis ${until} unterstützt.`,
    },
    history: {
      title: "Verlauf",
      empty: "Noch nichts eingerichtet oder installiert.",
      setupApplied: "Einrichtung angewendet",
      setupUndone: "Einrichtung rückgängig gemacht",
      setupPartial: "Einrichtung teilweise angewendet",
      restore: "Wiederherstellen",
      files: (n: number) => `${n} ${n === 1 ? "Datei" : "Dateien"}`,
      backups: (n: number) => `${n} ${n === 1 ? "Sicherung" : "Sicherungen"}`,
      installs: "Installationen und Updates stehen unter Aufträge (Strg+J).",
    },
  },
  remove: {
    title: (name: string, version: string) => `${name} ${version} deinstallieren?`,
    text: (path: string, size: string, name: string) =>
      `Gelöscht wird ${path} (${size}). Deine ${name}-Dateien und die Einrichtung bleiben.`,
    confirm: "Deinstallieren",
    done: (name: string) => `${name} ist deinstalliert.`,
    forgetTitle: (name: string) => `${name} aus der Liste entfernen?`,
    forgetText: "Das Programm bleibt auf dem Rechner, Cypher Studio merkt es sich nur nicht mehr.",
    forget: "Entfernen",
  },
  trademarkTitle: "Markenhinweise",
  trademarkText:
    "Krita, Inkscape, Blender und Kdenlive sind Marken ihrer jeweiligen Inhaber (Stichting Krita Foundation, Software Freedom Conservancy, Blender Foundation, KDE e.V.). Cypher Studio ist kein offizielles Produkt dieser Projekte und lädt sie unverändert aus ihren offiziellen Quellen.",
} as const;

export const install = {
  title: (name: string) => `${name} installieren`,
  titleUpdate: (name: string) => `${name} aktualisieren`,
  loadingPlan: "Übersicht vor dem Laden wird erstellt …",
  labels: {
    source: "Quelle",
    version: "Version",
    size: "Größe",
    license: "Lizenz",
    checksum: "Prüfsumme",
    target: "Zielordner",
    after: "Danach",
    consent: "Zustimmung",
  },
  official: "offizielle Quelle",
  whyThisSource: "Warum diese Quelle?",
  whyThisSourceText: (name: string, mirrors: boolean) =>
    mirrors
      ? `Steht im Programm-Katalog als offizielle Quelle von ${name}. Weiterleitungen gehen nur zu Servern derselben Liste; was ankommt, muss zur Prüfsumme passen.`
      : `Steht im Programm-Katalog als offizielle Quelle von ${name}. Es gibt keine Weiterleitung auf andere Server.`,
  versionLine: (version: string, channel: string, released: string | null) =>
    `${version} · ${channel}${released ? ` · erschienen ${released}` : ""}`,
  channel: { stable: "stabil", lts: "Langzeitversion", preview: "Vorschau" },
  sizeLine: (download: string, disk: string, drive: string, free: string) =>
    `${download} laden · ${disk} auf dem Datenträger · frei auf ${drive} ${free}`,
  licenseLine: (spdx: string, name: string) => `${spdx} · ${name}`,
  licenseText: "Lizenztext",
  checksumHash: "SHA-256",
  checksumOrigin: {
    upstream:
      "aus dem signierten Programm-Katalog · stimmt mit der Prüfsummendatei des Herstellers überein · wird nach dem Laden verglichen",
    cypherPinned:
      "aus dem signierten Programm-Katalog · vom Kollektiv festgeschrieben, weil der Hersteller keine eigene Prüfsumme veröffentlicht · wird nach dem Laden verglichen",
  },
  showAllGroups: "Alle 64 Zeichen zeigen",
  hideAllGroups: "Kurz zeigen",
  copyChecksum: "Prüfsumme kopieren",
  targetNoAdmin: "ohne Administratorrechte",
  targetChange: "Ändern",
  after: "Mit Cypher-Paletten, Schriften und Vorlagen einrichten",
  afterHint: "Danach siehst du jeden Baustein vor dem Anwenden. Rückgängig geht jederzeit.",
  consentText:
    "Cypher Studio lädt genau diese Datei aus dieser Quelle, vergleicht die Prüfsumme und installiert nur, wenn sie stimmt.",
  consentButton: "Laden und installieren",
  consentButtonUpdate: "Laden und aktualisieren",
  notes: {
    replaces: (name: string, version: string) =>
      `Ersetzt ${name} ${version}. Dein Einrichtungsstand bleibt erhalten und wird danach abgeglichen.`,
    existing: (name: string, version: string) =>
      `Du hast ${name} ${version} schon, installiert außerhalb von Studio. Es bleibt unberührt.`,
    note: (n: InstallNote): string => {
      switch (n.kind) {
        case "macosNotarizationCheck":
          return "macOS prüft die Notarisierung nach dem Entpacken.";
        case "macosNotNotarized":
          return "Dieses Programm ist von macOS nicht vorab geprüft. Der erste Start braucht deine Bestätigung.";
        case "intelMacOldRelease":
          return `Für Intel-Macs gilt die ältere Version ${n.version}.`;
        case "linuxFuseMissing":
          return "FUSE fehlt: Das Programm wird entpackt und von dort gestartet.";
        case "windowsSmartScreenNotExpected":
          return "Windows sollte keine Warnung zeigen.";
        case "largeDownload":
          return "Großer Download. Er läuft im Hintergrund weiter, wenn du den Dialog schließt.";
        case "catalogExpired":
          return "Der Programm-Katalog ist abgelaufen. Die Werte stimmen vermutlich noch, prüfe online nach.";
        case "resumeAvailable":
          return "Ein früherer Download wird fortgesetzt.";
      }
    },
  },
  phases: {
    download: "Laden",
    verify: "Prüfen",
    install: "Installieren",
    setup: "Einrichten",
  },
  phaseDetail: {
    download: (done: string, total: string, rate: string | null) => `${done} / ${total}${rate ? ` · ${rate}` : ""}`,
    verify: "SHA-256 wird verglichen",
    verifyDone: "Prüfsumme stimmt",
    extract: (done: string, total: string | null) =>
      total ? `entpackt ${done} von ${total} Dateien` : `entpackt ${done} Dateien`,
    checkContent: "Inhalt wird geprüft",
    register: "wird eingetragen",
    setup: (n: number) => `${n} ${n === 1 ? "Baustein" : "Bausteine"} werden angewendet`,
    setupDone: (n: number) => `${n} ${n === 1 ? "Baustein" : "Bausteine"} angewendet`,
    setupNeedsYou: "Die Einrichtung braucht deine Entscheidung zu geänderten Dateien.",
    pending: "wartet",
  },
  state: { done: "erledigt", running: "läuft", pending: "wartet", failed: "fehlgeschlagen" },
  background: "Im Hintergrund weiter",
  cancel: "Abbrechen",
  cancelling: "bricht ab …",
  escHint: "Esc schließt nicht, solange etwas läuft. Wähle „Im Hintergrund weiter“ oder „Abbrechen“.",
  doneTitle: (name: string, version: string) => `${name} ${version} installiert`,
  doneSetup: "und eingerichtet",
  doneSub: "Prüfsumme stimmt Gruppe für Gruppe.",
  expected: "Erwartet",
  computed: "Berechnet",
  launchAfter: (name: string) => `${name} starten`,
  openSetup: "Einrichtung ansehen",
  close: "Schließen",
  announce: {
    phase: (phase: string) => `${phase}`,
    done: (name: string, version: string) => `${name} ${version} installiert`,
    checksumOk: (name: string) => `${name}: Prüfsumme stimmt`,
  },
  errors: {
    checksum: {
      title: "Prüfsumme stimmt nicht. Die Datei wurde verworfen.",
      safe: "Es wurde nichts installiert und nichts ausgeführt. Dein Rechner ist nicht betroffen.",
      why: "Meist ist der Download unterwegs beschädigt worden. Selten wurde die Datei am Server verändert. Darum installieren wir nur, was zur Prüfsumme passt.",
      retry: "Erneut laden und prüfen",
      copy: "Details kopieren",
      copied: "Details kopiert",
      expected: "Erwartet",
      expectedFrom: "aus dem Programm-Katalog",
      actual: "Berechnet",
      actualFrom: "aus deiner Datei",
      differs: (n: number, total: number) =>
        n === 1 ? `1 von ${total} Blöcken weicht ab.` : `${n} von ${total} Blöcken weichen ab.`,
      region: "Sicherheitswarnung",
      detailsText: (name: string, file: string, expected: string, actual: string) =>
        `${name}: Prüfsumme falsch\nDatei: ${file}\nErwartet: ${expected}\nBerechnet: ${actual}`,
    },
    network: {
      title: (host: string, done: string, total: string) =>
        `Verbindung zu ${host} abgebrochen bei ${done} von ${total} MB.`,
      titlePlain: (host: string) => `Verbindung zu ${host} abgebrochen.`,
      safe: "Nichts ist installiert. Mit „Jetzt erneut“ geht es weiter, sobald du online bist.",
      now: "Jetzt erneut",
    },
    disk: {
      title: (drive: string, missing: string) => `Auf ${drive} fehlen ${missing}.`,
      safe: "Es wurde nichts geladen.",
      other: "Anderen Zielordner",
    },
    running: {
      title: (name: string) => `${name} ist noch geöffnet.`,
      text: (name: string) =>
        `Speichere und schließe ${name}, dann geht es weiter. Cypher Studio beendet nie fremde Programme.`,
      retry: "Erneut prüfen",
    },
    cancelled: {
      title: "Abgebrochen.",
      text: "Teildateien wurden gelöscht. Installiert wurde nichts.",
      again: "Erneut starten",
    },
    expiredPlan: {
      title: "Die Übersicht vor dem Laden ist abgelaufen.",
      text: "Sie gilt 10 Minuten. Es wurde nichts geladen.",
      again: "Neu anzeigen",
    },
    stale: (name: string, newer: string, shown: string) =>
      `${name} ${newer} ist erschienen, aber noch nicht von uns geprüft. Bis dahin installieren wir ${shown}.`,
    generic: { retry: "Erneut versuchen", close: "Schließen" },
  },
} as const;

export const setup = {
  title: "Einrichtung",
  summaryApplied: (label: string) => `${label} · angewendet`,
  summaryPartial: (label: string, current: number, total: number) => `${label} · teilweise (${current} von ${total})`,
  summaryNone: (label: string) => `${label} · noch nicht angewendet`,
  needsInstall: "Erst installieren, dann einrichten.",
  installFirst: (name: string) => `${name} installieren`,
  columns: { block: "Baustein", preview: "Vorschau", target: "Ziel", status: "Status" },
  status: {
    current: "aktuell",
    new: "neu",
    outdated: "veraltet",
    userModified: "von dir geändert",
    partial: "teilweise",
    compare: "vergleicht …",
  },
  optional: "optional",
  colors: (n: number) => `${n} Farben`,
  paletteStrip: "Farbstreifen der Palette",
  conflict: {
    label: "Geändert",
    overwrite: "Überschreiben",
    keepBoth: (name: string) => `Daneben ablegen als ${name}`,
    skip: "Überspringen",
    hint: "Cypher Studio überschreibt nie still. Überschreiben legt zuerst eine Sicherung an.",
    choose: (label: string) => `Wahl für ${label}`,
  },
  scope: {
    userProfile: "Benutzerprofil",
    portableInstall: "Programmordner der Installation",
    flatpakProfile: "Flatpak-Profil",
    snapProfile: "Snap-Profil",
    userFonts: "Benutzerschriften",
  },
  scopeLabel: "Ziel der Einrichtung",
  running: "Krita ist geöffnet",
  runningHint: (name: string) => `${name} ist geöffnet. Neue Bausteine erscheinen nach einem Neustart.`,
  restartHint: (name: string) => `${name} neu starten, damit die Bausteine erscheinen.`,
  apply: "Einrichtung anwenden",
  applying: "Wende an",
  summary: (n: number, news: number, updates: number) =>
    `${n} ${n === 1 ? "Baustein" : "Bausteine"} · ${news} neu · ${updates} aktualisiert`,
  summaryBackup: "Sicherung wird angelegt",
  appliedBar: (time: string, backup: boolean, restart: string | null) =>
    `Angewendet ${time}${backup ? " · Sicherung angelegt" : ""}${restart ? ` · ${restart}` : ""}`,
  undo: "Rückgängig",
  undone: (restored: number, removed: number) =>
    `Rückgängig gemacht: ${restored} ${restored === 1 ? "Sicherung" : "Sicherungen"} zurückgespielt, ${removed} ${removed === 1 ? "Datei" : "Dateien"} entfernt.`,
  keptModified: (n: number) => `${n} von dir geänderte ${n === 1 ? "Datei bleibt" : "Dateien bleiben"} liegen.`,
  launch: (name: string) => `${name} starten`,
  lockedFile: (file: string, name: string) => `${file} ist von ${name} gesperrt. Schließe ${name} und wende erneut an.`,
  failures: "Nicht alles ging",
  failureTitle: (n: number) => `${n} ${n === 1 ? "Baustein" : "Bausteine"} konnten nicht geschrieben werden`,
  selectAll: "Alle Bausteine",
  componentKind: {
    palette: "Palette",
    fonts: "Schriften",
    templates: "Vorlagen",
    workspace: "Arbeitsfläche",
    bundle: "Ressourcenbündel",
    appTemplate: "App-Vorlage",
    extension: "Erweiterung",
    assetLibrary: "Asset-Bibliothek",
    titles: "Titelvorlagen",
    videoProfiles: "Projektprofile",
    renderPreset: "Render-Profil",
  },
  opKind: {
    create: "neu anlegen",
    update: "ersetzen",
    skip: "unverändert",
    conflict: "Konflikt",
    installFont: "Schrift installieren",
    blenderExtension: "Erweiterung installieren",
    writeConfig: "Einstellung schreiben",
  },
  statusLine: (name: string, applied: boolean) =>
    applied ? `${name}: eingerichtet` : `${name}: noch nicht eingerichtet`,
  announceDone: (n: number) => `Einrichtung angewendet: ${n} Bausteine`,
  openFolder: "Ordner öffnen",
} as const;
