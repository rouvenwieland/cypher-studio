/**
 * Cypher Studio – IPC-Vertrag zwischen Rust-Kern (Team A) und Frontend (Team B)
 * ============================================================================
 * Stand 17.10.2026 · Vertragsversion 0.3.0 · gehört zu docs/ARCHITEKTUR.md, Abschnitt 3
 * Bildschirme und Abläufe: docs/CONCEPT.md, Gestaltung: docs/DESIGN.md + docs/tokens.css
 *
 * Diese Datei ist die KANONISCHE Quelle für alle Typen, die über die Tauri-IPC-Grenze gehen.
 * Änderungen nur per Vertragsänderungs-PR (Zone I, siehe ARCHITEKTUR.md 1.3); beide Teams reviewen.
 * Das Frontend importiert sie über den Alias `@contract` (vite.config.ts + tsconfig paths).
 * Team A erzeugt mit ts-rs die Rust-Seite nach apps/desktop/src/ipc/generated/ und
 * apps/desktop/src/ipc/contract-check.ts prüft zur Compile-Zeit, dass beide Seiten gleich sind.
 *
 * KONVENTIONEN
 * - Command-Namen snake_case, Präfix = Rust-Modul (install_preview, library_query, …).
 * - Jeder Command hat höchstens EIN Argument `req` (Request-Objekt) und optional `onEvent` (Channel):
 *     JS:   invoke("install_preview", { req: { programId: "blender" } })
 *     Rust: async fn install_preview(ctx: State<'_, AppCtx>, req: InstallPreviewReq) -> Result<InstallPlan, AppError>
 * - Felder camelCase (Rust: #[serde(rename_all = "camelCase")]).
 * - Optionale Request-Felder: `feld?: T`   (Rust: Option<T> + #[serde(default)] + #[ts(optional)]).
 *   Antwortfelder sind immer vorhanden: `feld: T | null` (Rust: Option<T>).
 * - Getaggte Unions: `type` bei Ereignissen und Daten, `kind` bei Fehlern und Referenzen
 *   (Rust: #[serde(tag = "type" | "kind", rename_all = "camelCase", rename_all_fields = "camelCase")],
 *   nur Struct-Varianten, keine Tupel-Varianten).
 * - Zeit: RFC 3339, UTC. Größen in Bytes (number, < 2^53). Längen in mm, Pixel ganzzahlig.
 * - PFADE: Rust liefert `DisplayPath` NUR ZUR ANZEIGE. Das Frontend schickt NIE Pfade an Rust,
 *   sondern IDs (FileHandleId, LibraryEntryId, ProjectId, InstallationId, PlanId …).
 * - Fehler: jeder Command rejected mit `AppError`. Abgebrochene Dialoge sind KEIN Fehler (Ergebnis null bzw. []).
 * - Texte: Rust liefert keine deutschen UI-Texte, sondern Codes + Parameter. Texte erzeugt das Frontend
 *   (src/i18n/de.ts). Ausnahme: Katalogtexte (Programmbeschreibungen) und Vorlagentitel sind bereits deutsch.
 */

export const IPC_CONTRACT_VERSION = "0.3.0" as const;

/* ========================================================================== */
/* 0. Grundtypen                                                              */
/* ========================================================================== */

export type IsoDateTime = string; // RFC 3339, UTC, z. B. "2026-10-16T18:30:00Z"
export type Sha256Hex = string; // 64 Zeichen, Kleinbuchstaben
export type SemVer = string; // App- und Paketversionen: "0.1.0-beta.2"
export type ProgramVersion = string; // Programmversionen, punktnumerisch: "5.2.2", "5.3.4.1", "26.08.2"
export type SpdxId = string; // "GPL-3.0-or-later"
export type DisplayPath = string; // nur Anzeige, nie zurück an Rust
export type AssetUrl = string; // von Rust gebaute URL für <img>/Canvas (cyfile:, cythumb:, cyasset:, unter Windows http://<schema>.localhost/…)
export type HexColor = string; // "#141210"

export type ProgramId = string; // kebab-case, z. B. "blender", "krita", "inkscape", "kdenlive"
export type InstallationId = string; // "cypher:blender:4.5.3", "system:blender:<hash>", "flatpak:org.blender.Blender"
export type PlanId = string; // UUID v4, 10 min gültig
export type JobId = string; // UUID v4
export type FileHandleId = string; // undurchsichtig, gilt nur in der laufenden Sitzung
export type LibraryEntryId = string; // UUID aus der Sidecar-Datei
export type ProjectId = string; // UUID aus cypher-project.json
export type TemplateId = string; // "builtin:shirt-krita", "library:<entryId>"
export type PrintProfileId = string; // "shirtigo-tee-front"
export type GarmentColorId = string; // "schwarz", "weiss", "grau-meliert", "navy", "sand", "creme"
export type SetupScopeId = string; // Hash über die aufgelösten Zielwurzeln
export type SetupId = string; // UUID je angewendeter Einrichtung
export type MockupTemplateId = string;
export type SocialTemplateId = string;

export type Os = "windows" | "macos" | "linux";
export type Arch = "x86_64" | "aarch64";

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Strukturell kompatibel mit `Channel<T>` aus @tauri-apps/api/core.
 * Rust: tauri::ipc::Channel<T>, Parametername `on_event` (JS: `onEvent`).
 */
export interface IpcChannel<T> {
  onmessage: (message: T) => void;
}

/* ========================================================================== */
/* 1. Fehler (getaggte Enum, Feld `kind`)                                     */
/* ========================================================================== */

export type EntityKind =
  | "program"
  | "installation"
  | "plan"
  | "job"
  | "fileHandle"
  | "libraryEntry"
  | "project"
  | "template"
  | "printProfile"
  | "setupScope"
  | "setupRecord"
  | "mockupTemplate"
  | "socialTemplate"
  | "garmentColor"
  | "artifact"
  | "catalogLink" // 0.3.0: unbekannter Verweis aus dem Katalog („Nur Verweis“)
  | "setupPack"; // 0.3.0: unbekanntes Einrichtungspaket

export type BusyReason = "jobRunning" | "setupRunning" | "updateRunning" | "programRunning";
export type IoOp = "read" | "write" | "rename" | "remove" | "createDir" | "copy" | "metadata" | "spawn" | "mount";
export type SignatureSubject = "catalog" | "artifact" | "appUpdate";
export type UnsafeEntryReason =
  | "absolutePath"
  | "parentTraversal"
  | "symlinkEscape"
  | "hardlink"
  | "deviceFile"
  | "reservedName"
  | "invalidCharacters"
  | "duplicateEntry";
export type SetupUnsupportedReason = "noPack" | "programVersion" | "installKind" | "platform";

export type AppError =
  | { kind: "notFound"; entity: EntityKind; id: string }
  | { kind: "invalidInput"; field: string; reason: string }
  | { kind: "planExpired"; planId: PlanId }
  | { kind: "consentMismatch"; planId: PlanId }
  | { kind: "busy"; reason: BusyReason; jobId: JobId | null }
  | { kind: "cancelled" }
  | { kind: "io"; op: IoOp; path: DisplayPath | null; message: string }
  | { kind: "permissionDenied"; path: DisplayPath }
  | { kind: "diskFull"; path: DisplayPath; neededBytes: number; availableBytes: number }
  | { kind: "network"; host: string; message: string; retryable: boolean }
  | { kind: "httpStatus"; host: string; status: number }
  | { kind: "hostNotAllowed"; host: string }
  | { kind: "insecureUrl"; url: string }
  | { kind: "checksumMismatch"; file: string; expected: Sha256Hex; actual: Sha256Hex }
  | { kind: "sizeMismatch"; file: string; expected: number; actual: number }
  | { kind: "signatureInvalid"; subject: SignatureSubject; reason: string }
  | { kind: "catalogRollback"; currentSequence: number; offeredSequence: number }
  | { kind: "catalogIncompatible"; schemaVersion: number; minAppVersion: SemVer }
  | { kind: "unsupportedPlatform"; programId: ProgramId; os: Os; arch: Arch }
  | { kind: "archiveInvalid"; reason: string }
  | { kind: "archiveUnsafeEntry"; entry: string; reason: UnsafeEntryReason }
  | { kind: "archiveTooLarge"; limitBytes: number }
  | { kind: "installVerificationFailed"; reason: string }
  | { kind: "launchFailed"; programId: ProgramId; reason: string }
  | { kind: "setupConflict"; files: DisplayPath[] }
  | { kind: "setupUnsupported"; packId: PackId; reason: SetupUnsupportedReason }
  | { kind: "imageDecode"; reason: string }
  | { kind: "imageTooLarge"; widthPx: number; heightPx: number; maxPixels: number }
  | { kind: "unsupportedFormat"; format: string; supported: string[] }
  | { kind: "libraryNotConfigured" }
  | { kind: "libraryRootInvalid"; reason: "notADirectory" | "notWritable" | "insideAppData" | "systemDirectory" }
  | { kind: "packInvalid"; reason: string }
  | { kind: "updateFailed"; reason: string }
  | { kind: "internal"; message: string; correlationId: string };

export type AppErrorKind = AppError["kind"];

/* ========================================================================== */
/* 2. App, Einstellungen, Netzwerk, Diagnose                                  */
/* ========================================================================== */

export interface AppInfo {
  appVersion: SemVer;
  contractVersion: string; // muss IPC_CONTRACT_VERSION entsprechen, sonst Warnbanner (nur Entwicklung)
  os: Os;
  arch: Arch; // tatsächliche Hardware (macOS: Apple Silicon auch unter Rosetta = "aarch64")
  osVersion: string;
  dataDir: DisplayPath;
  logsDir: DisplayPath;
  buildChannel: "stable" | "beta" | "dev";
}

/** Ziele für "im Browser öffnen". Das Frontend schickt NIE eine freie URL. */
export type ExternalTarget =
  | { kind: "programPage"; programId: ProgramId; page: "homepage" | "license" | "releaseNotes" }
  | { kind: "catalogLink"; linkId: string } // z. B. "affinity"
  | { kind: "appPage"; page: "help" | "sourceCode" | "thirdParty" | "releaseNotes" | "downloads" };

/** Ziele für "im Dateimanager zeigen". */
export type RevealTarget =
  | { kind: "installation"; installationId: InstallationId }
  | { kind: "project"; projectId: ProjectId }
  | { kind: "projectFile"; projectId: ProjectId; relPath: string }
  | { kind: "libraryEntry"; entryId: LibraryEntryId }
  | { kind: "libraryRoot" }
  | { kind: "fileHandle"; handleId: FileHandleId }
  | { kind: "logs" }
  | { kind: "printProfiles" }
  | { kind: "setupBackups"; packId: PackId };

export type UpdateFrequency = "daily" | "weekly" | "never";

/** Vom Frontend verwaltete Oberflächen-Einstellungen (CONCEPT.md 6.9). Rust speichert sie geprüft (≤ 64 KB). */
export interface UiPreferences {
  theme: "system" | "paper" | "ink";
  density: "compact" | "normal" | "large";
  motion: "system" | "reduced" | "full";
  zoomPercent: number; // 50..200
  measureColor: "cyan" | "magenta" | "ink" | "paper";
  surround: { paper: "light" | "mid" | "dark"; ink: "light" | "mid" | "dark" };
  calibrationPxPerMm: number | null; // "Echtgröße kalibrieren"
  singleKeyShortcuts: boolean;
  shortcutOverrides: Record<string, string>; // Befehls-ID → Tastenkombination
}

/** Erststart „In 30 Minuten startklar“ (CONCEPT.md 6.10): Stand bleibt erhalten. */
export interface OnboardingState {
  status: "notStarted" | "inProgress" | "done" | "skipped";
  step: number; // 0..6
  selectedPrograms: ProgramId[];
  applySetup: boolean;
  updatedAt: IsoDateTime | null;
}

export interface Settings {
  schemaVersion: 1;
  updates: { frequency: UpdateFrequency; lastCheckAt: IsoDateTime | null };
  catalog: { autoRefresh: boolean };
  programsDir: DisplayPath; // Ziel für portable Installationen (ändern über settings_choose_dir)
  projectsDir: DisplayPath; // Standard: <Bibliothek>/Projekte, ohne Bibliothek <Dokumente>/Cypher Studio/Projekte
  libraryRoot: DisplayPath | null; // ändern über library_choose_root + library_use_root
  downloads: { keepCache: boolean; maxParallel: 1 | 2 | 3 };
  linux: { appImageMode: "auto" | "extract" | "direct"; graphicsCompat: boolean };
  profile: { displayName: string }; // nur lokal; Autorenfeld in Bibliothek/Austauschpaketen
  ui: UiPreferences;
  onboarding: OnboardingState;
}

export interface SettingsPatch {
  updates?: { frequency?: UpdateFrequency };
  catalog?: { autoRefresh?: boolean };
  downloads?: { keepCache?: boolean; maxParallel?: 1 | 2 | 3 };
  linux?: { appImageMode?: "auto" | "extract" | "direct"; graphicsCompat?: boolean };
  profile?: { displayName?: string };
  ui?: Partial<UiPreferences>;
  onboarding?: Partial<OnboardingState>;
}

export interface SettingsChooseDirReq {
  which: "programsDir" | "projectsDir";
}

export interface OpenExternalReq {
  target: ExternalTarget;
}
export interface RevealReq {
  target: RevealTarget;
}

/** Einstellungen → „Netzwerk und Daten“: alle Adressen, die Studio anfragt (DESIGN.md Vertrag „Datenschutz“). */
export type NetworkPurpose = "catalog" | "appUpdate" | "programDownload" | "modelDownload";

export interface NetworkEndpoint {
  purpose: NetworkPurpose;
  host: string;
  urlPattern: string; // z. B. "https://download.blender.org/release/…"
  when: "onStart" | "onDemand" | "afterConsent";
  enabled: boolean; // abschaltbar über Einstellungen (Katalog, Updates)
}

export interface NetworkRequestLog {
  at: IsoDateTime;
  host: string;
  purpose: NetworkPurpose;
  status: number | null; // HTTP-Status, null bei Netzwerkfehler
  bytes: number;
}

export interface NetworkInfo {
  endpoints: NetworkEndpoint[];
  recent: NetworkRequestLog[]; // letzte 200 Anfragen dieser und der letzten Sitzung (lokal)
  telemetry: false;
}

/* ========================================================================== */
/* 3. Katalog                                                                 */
/* ========================================================================== */

export interface CatalogStatus {
  sourceUrl: string | null; // Manifest-Quelle (nur lesen), null bei eingebettetem Katalog
  schemaVersion: number;
  sequence: number;
  generatedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  expired: boolean; // nur Warnung, blockiert nichts
  source: "remote" | "cache" | "embedded";
  lastCheckAt: IsoDateTime | null;
  lastError: AppError | null;
}

export interface CatalogRefreshResult {
  status: CatalogStatus;
  changed: boolean;
}

export interface LicenseInfo {
  spdx: SpdxId;
  name: string; // "GNU General Public License v3.0 or later"
  url: string; // nur Anzeige; Öffnen über ExternalTarget programPage/license
}

export interface CatalogLink {
  id: string; // "affinity"
  name: string;
  description: string;
  note: string | null; // z. B. "Nicht quelloffen; nur Verweis, keine Installation durch Cypher Studio."
}

/* ========================================================================== */
/* 4. Programme, Installationen, Installation                                 */
/* ========================================================================== */

export type ProgramCategory = "raster" | "vector" | "3d" | "video" | "audio" | "upscale" | "other";

export type InstallKind = "cypher" | "system" | "flatpak" | "snap" | "msstore" | "steam" | "manual";

export type InstallationProblem =
  | { kind: "executableMissing" }
  | { kind: "fuseMissing"; fallback: "extractAndRun" | "extracted" }
  | { kind: "notNotarized" } // macOS: spctl lehnt ab
  | { kind: "versionUnknown" }
  | { kind: "setupNotSupported"; reason: SetupUnsupportedReason }
  | { kind: "staleCatalogVersion"; latest: ProgramVersion } // nur Hinweis "Update verfügbar"
  | { kind: "endOfSupportSoon"; until: string }; // z. B. Blender 4.5 LTS auf Intel-Macs

export interface Installation {
  id: InstallationId;
  programId: ProgramId;
  version: string | null;
  kind: InstallKind;
  managedByCypher: boolean; // true nur bei kind "cypher": darf von Cypher Studio entfernt werden
  location: DisplayPath; // exe, .app, AppImage oder Flatpak-ID
  launchable: boolean;
  problems: InstallationProblem[];
  installedAt: IsoDateTime | null;
  detectedAt: IsoDateTime;
  verified: { sha256: Sha256Hex; catalogSequence: number; signatureChecked: boolean } | null;
  setupScopeId: SetupScopeId | null; // null = Einrichtung für diese Installation nicht möglich
}

export type ReleaseChannel = "stable" | "lts" | "preview";

export interface ProgramRelease {
  version: ProgramVersion;
  channel: ReleaseChannel;
  releasedAt: IsoDateTime | null;
  downloadSize: number;
  availableForThisPlatform: boolean;
}

export type SetupStatus = "notApplied" | "applied" | "outdated" | "partial" | "unsupported";

export interface SetupScope {
  scopeId: SetupScopeId;
  /** userProfile = Benutzerprofil, gilt für alle System-Installationen; portableInstall = Konfiguration im Programmordner */
  scopeKind: "userProfile" | "portableInstall" | "flatpakProfile" | "snapProfile" | "userFonts";
  componentsApplied: string[];
  targetRoots: DisplayPath[]; // aufgelöste Zielordner (Anzeige in der Vorschau)
  installationIds: InstallationId[];
  status: SetupStatus;
  record: SetupRecord | null;
}

export type PackId = string; // "krita", "inkscape", "blender", "kdenlive", "fonts"

export interface SetupSummary {
  packId: PackId;
  programId: ProgramId | null; // null = programmübergreifend (Paket "fonts")
  title: string; // "Cypher-Einrichtung für Krita"
  packVersion: SemVer;
  requiresPacks: PackId[]; // z. B. ["fonts"]: Vorschau schlägt diese zuerst vor
  scopes: SetupScope[];
}

export interface ProgramOverview {
  id: ProgramId;
  name: string;
  vendor: string;
  category: ProgramCategory;
  description: string; // deutsch, aus dem Katalog
  license: LicenseInfo;
  supportedOnThisPlatform: boolean;
  latest: ProgramRelease | null;
  installations: Installation[];
  preferredInstallationId: InstallationId | null;
  updateAvailable: boolean; // eine Cypher-Installation ist älter als `latest`
  setup: SetupSummary | null; // null = kein Einrichtungspaket für dieses Programm
}

export interface ProgramsView {
  programs: ProgramOverview[];
  links: CatalogLink[];
  catalog: CatalogStatus;
}

export type ArtifactKind = "zip" | "7z" | "tarXz" | "tarGz" | "dmg" | "appImage" | "sfx7z" | "exeInstaller";

export interface SignatureInfo {
  type: "pgp" | "minisign";
  enforced: boolean; // false = schwache Upstream-Signatur, nur protokolliert
  url: string; // Anzeige
  signerFingerprints: string[]; // PGP: 40 Hex-Zeichen; minisign: Key-ID
}

export interface InstallPreviewReq {
  programId: ProgramId;
  version?: ProgramVersion; // fehlt = neueste für diese Plattform im Kanal
  channel?: ReleaseChannel; // Standard: lts, sonst stable
}

export interface InstallPlan {
  planId: PlanId;
  programId: ProgramId;
  programName: string;
  version: ProgramVersion;
  channel: ReleaseChannel;
  source: {
    label: string; // "download.blender.org (offizielle Quelle)"
    host: string;
    url: string; // Anzeige
    mirrorRedirects: boolean; // true = Spiegelserver möglich, Inhalt ist über sha256 festgenagelt
  };
  artifact: {
    kind: ArtifactKind;
    fileName: string;
    size: number;
    sha256: Sha256Hex;
    checksumSource: string; // URL der offiziellen Prüfsummendatei (Anzeige)
    checksumOrigin: "upstream" | "cypherPinned"; // cypherPinned = keine offizielle Summe, von der Katalog-Pflege festgeschrieben
    signature: SignatureInfo | null;
  };
  license: LicenseInfo;
  target: {
    dir: DisplayPath; // <programsDir>/<programId>/<version>
    requiredBytes: number; // Download + entpackt (Schätzung aus Katalog)
    availableBytes: number;
    portable: true;
    needsAdmin: false;
  };
  replaces: Installation | null; // ältere Cypher-Installation desselben Programms
  existing: Installation[]; // bereits erkannte Installationen (Hinweis: "Du hast Blender 4.2 schon")
  notes: InstallNote[];
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export type InstallNote =
  | { kind: "macosNotarizationCheck" }
  | { kind: "macosNotNotarized" } // z. B. Kdenlive: Start nur nach Bestätigung
  | { kind: "intelMacOldRelease"; version: ProgramVersion }
  | { kind: "linuxFuseMissing"; fallback: "extractAndRun" | "extracted" }
  | { kind: "windowsSmartScreenNotExpected" }
  | { kind: "largeDownload"; bytes: number }
  | { kind: "catalogExpired" }
  | { kind: "resumeAvailable"; bytesDone: number };

/** Bindet die Zustimmung an genau das, was angezeigt wurde. Rust prüft alle Felder gegen den Plan. */
export interface InstallConsent {
  planId: PlanId;
  sha256: Sha256Hex;
  licenseSpdx: SpdxId;
  targetDir: DisplayPath;
  acceptedAt: IsoDateTime;
}

export interface InstallStartReq {
  planId: PlanId;
  consent: InstallConsent;
}

export type InstallPhase = "download" | "verifyChecksum" | "verifySignature" | "extract" | "checkContent" | "register";

export type InstallEvent =
  | { type: "started"; jobId: JobId; totalBytes: number }
  | { type: "phase"; phase: InstallPhase }
  | { type: "downloadProgress"; downloadedBytes: number; totalBytes: number; bytesPerSecond: number }
  | { type: "resumed"; fromByte: number }
  | { type: "retrying"; attempt: number; maxAttempts: number; delayMs: number; reason: string }
  | { type: "verified"; sha256: Sha256Hex; signatureChecked: boolean }
  | { type: "extractProgress"; entriesDone: number; entriesTotal: number | null; bytesWritten: number }
  | { type: "finished"; installation: Installation };

export interface InstallationRemoveReq {
  installationId: InstallationId;
  /** "deleteFiles" nur für managedByCypher; "forget" nur für kind "manual". */
  mode: "deleteFiles" | "forget";
}

export interface SetPreferredReq {
  programId: ProgramId;
  installationId: InstallationId;
}

export interface AddManualReq {
  programId: ProgramId; // öffnet nativen Dialog zur Auswahl von exe/.app/AppImage
}

/* ========================================================================== */
/* 5. Starten                                                                 */
/* ========================================================================== */

export interface LaunchReq {
  programId: ProgramId;
  installationId?: InstallationId; // fehlt = bevorzugte Installation
  files?: FileHandleId[]; // werden als Argumente übergeben (keine Shell)
  mode?: "normal" | "blenderAppTemplate"; // blenderAppTemplate = --app-template cypher_ps2
}

export interface LaunchResult {
  programId: ProgramId;
  installationId: InstallationId;
  pid: number | null; // null bei Flatpak/Store-Start über Vermittler
  startedAt: IsoDateTime;
}

/* ========================================================================== */
/* 6. Cypher-Einrichtung (Bausteine je Paket, CONCEPT.md 6.3)                 */
/* ========================================================================== */

export interface SetupPreviewReq {
  packId: PackId;
  scopeId: SetupScopeId;
}

export type SetupComponentKind =
  | "palette"
  | "fonts"
  | "templates"
  | "workspace"
  | "bundle" // Krita-Ressourcenbundle
  | "appTemplate" // Blender-App-Vorlage cypher_ps2
  | "extension" // Blender-Extension cypher_export
  | "assetLibrary" // Blender-Asset-Bibliothek → <Bibliothek>/3D
  | "titles" // Kdenlive-Titelvorlagen
  | "videoProfiles" // Kdenlive-Projektprofile
  | "renderPreset";

export type SetupComponentStatus = "current" | "new" | "outdated" | "userModified" | "partial";

export type SetupOperationKind =
  | "create" // Datei neu
  | "update" // eigene Datei aus früherer Einrichtung, unverändert → wird ersetzt
  | "skip" // identisch vorhanden
  | "conflict" // fremde oder vom Nutzer geänderte Datei: Nutzer entscheidet (SetupConflict)
  | "installFont"
  | "blenderExtension" // blender --command extension install-file …
  | "writeConfig"; // kleine eigene Konfigurationsdatei (z. B. Pfad der Asset-Bibliothek für das Add-on)

export interface SetupOperation {
  kind: SetupOperationKind;
  target: DisplayPath;
  sourceId: string; // Datei-ID im Paket-Manifest
  bytes: number;
  conflictId: string | null;
}

export interface SetupComponent {
  id: string; // aus pack.json, z. B. "palette"
  kind: SetupComponentKind;
  label: string; // deutsch, aus pack.json: „Palette „Cypher Kollektionen““
  optional: boolean;
  defaultSelected: boolean;
  status: SetupComponentStatus;
  preview: { colors: HexColor[]; formats: string[]; fonts: string[] };
  operations: SetupOperation[];
}

export interface SetupConflict {
  conflictId: string;
  componentId: string;
  target: DisplayPath;
  reason: "userModified" | "foreignFile";
  keepBothName: string; // Vorschlag für „Daneben ablegen“, z. B. "cypher-2026-10.kpl"
}

export interface SetupPlan {
  planId: PlanId;
  packId: PackId;
  programId: ProgramId | null;
  scopeId: SetupScopeId;
  packVersion: SemVer;
  packLabel: string; // „Cypher-Paket 2026.10“
  previous: SetupRecord | null;
  components: SetupComponent[];
  conflicts: SetupConflict[];
  programRunning: boolean; // Hinweis, kein Abbruch („Neue Paletten erscheinen nach einem Neustart“)
  restartHint: boolean;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export type ConflictResolution = "overwrite" | "keepBoth" | "skip"; // overwrite legt IMMER eine Sicherung an

export interface SetupApplyReq {
  planId: PlanId;
  components: string[]; // gewählte Baustein-IDs
  resolutions: Record<string, ConflictResolution>; // conflictId → Entscheidung; fehlende = "skip"
}

export type SetupEvent =
  | { type: "started"; jobId: JobId; total: number }
  | { type: "step"; index: number; total: number; componentId: string; operation: SetupOperation }
  | { type: "finished"; record: SetupRecord };

export interface SetupRecord {
  setupId: SetupId;
  packId: PackId;
  programId: ProgramId | null;
  scopeId: SetupScopeId;
  packVersion: SemVer;
  components: string[];
  appliedAt: IsoDateTime;
  status: "applied" | "partial" | "undone";
  filesWritten: number;
  backupsTaken: number;
  undoAvailable: boolean; // bis zur nächsten Anwendung im selben Scope
  failures: { target: DisplayPath; error: AppError }[]; // z. B. gesperrte Dateien, je Zeile gemeldet
}

export interface SetupUndoReq {
  setupId: SetupId;
}

export interface UndoReport {
  setupId: SetupId;
  restored: number; // Sicherungen zurückgespielt
  removed: number; // eigene Dateien entfernt
  keptModified: DisplayPath[]; // vom Nutzer seit der Einrichtung geänderte Dateien: bleiben liegen
  fontsRemoved: number;
  extensionsRemoved: number; // 0.3.0: mit Blender installierte Erweiterungen, die beim Zurücknehmen entfernt wurden
}

export interface SetupStatusReq {
  packId: PackId;
}

export interface SetupHistoryReq {
  packId: PackId;
  scopeId: SetupScopeId;
}

/* ========================================================================== */
/* 7. Dateien (Handles statt Pfade)                                           */
/* ========================================================================== */

export type FilePurpose = "printcheck" | "mockupDesign" | "socialImage" | "bgremove" | "libraryImport" | "packImport" | "openAny";

export interface FilePickReq {
  purpose: FilePurpose; // bestimmt Dateifilter des nativen Dialogs
  multiple?: boolean;
}

export interface FileHandleInfo {
  id: FileHandleId;
  name: string; // Dateiname ohne Pfad
  displayPath: DisplayPath;
  size: number;
  mime: string; // per Inhalt erkannt, nicht per Endung
  url: AssetUrl | null; // nur für Bilder (png, jpeg, webp, tiff → PNG-Vorschau)
  source: "dialog" | "drop" | "library" | "project" | "export" | "sample";
}

/**
 * RAW-Command export_save_image: Körper = Bilddaten (Uint8Array, PNG oder JPEG), Metadaten als Header.
 * JS: invoke("export_save_image", bytes, { headers: exportImageHeaders(meta) })
 * Rust: async fn export_save_image(ctx, request: tauri::ipc::Request<'_>) -> Result<Option<FileHandleInfo>, AppError>
 * Header-Werte ASCII, daher fileName per encodeURIComponent.
 */
export interface ExportImageMeta {
  fileName: string; // Vorschlag, ohne Pfad
  format: "png" | "jpeg";
  destination: { kind: "dialog" } | { kind: "project"; projectId: ProjectId; folder: ProjectFolder } | { kind: "library"; subfolder: string };
  dpi?: number; // nur PNG: pHYs wird gesetzt
}
export const EXPORT_IMAGE_HEADERS = {
  meta: "x-cypher-export-meta", // JSON von ExportImageMeta, encodeURIComponent
} as const;
export const EXPORT_IMAGE_MAX_BYTES = 64 * 1024 * 1024;

/* ========================================================================== */
/* 8. Projekte und Vorlagen (Projekt = Ordner im gemeinsamen Ordner)          */
/* ========================================================================== */

/** Unterordner eines Projekts (CONCEPT.md 4 „Objekte“, ergänzt um Social/, Video/, 3D/). */
export type ProjectFolder = "Motive" | "Mockups" | "Social" | "Video" | "3D" | "Export/Druck" | "Export/Social";

export interface TemplateInfo {
  id: TemplateId;
  title: string; // „Shirt vorne“
  description: string;
  target: "program" | "mockup" | "social";
  programId: ProgramId | null; // bei target "program"
  format: {
    label: string; // „330 × 450 mm“, „1080 × 1350“
    widthPx: number;
    heightPx: number;
    dpi: number | null;
    widthMm: number | null;
    heightMm: number | null;
  };
  aspect: number; // Breite / Höhe, für die Formatleiste
  folder: ProjectFolder; // wohin die neue Datei kommt
  fileExtension: string; // ".kra", ".svg", ".blend", ".kdenlive", ".mockup.json", ".social.json"
  printProfileId: PrintProfileId | null;
  previewUrl: AssetUrl | null;
  source: "builtin" | "library"; // library = <Bibliothek>/Vorlagen
  requiresSetup: boolean; // z. B. Blender-App-Vorlage braucht Einrichtung
  tags: string[];
}

export interface ProjectFileRef {
  relPath: string; // relativ zum Projektordner, "/" als Trenner
  modifiedAt: IsoDateTime;
  programId: ProgramId | null; // passendes Programm nach Dateityp
  module: "mockup" | "social" | null; // eigenes Modul-Dokument
}

export interface Project {
  id: ProjectId;
  name: string;
  collection: string | null; // Collection.id
  dir: DisplayPath;
  inLibrary: boolean; // liegt im gemeinsamen Ordner
  fileCount: number;
  lastFile: ProjectFileRef | null; // „zuletzt: rauschen_signal_v3.kra“
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  missing: boolean; // Ordner nicht mehr vorhanden
}

export interface ProjectCreateReq {
  name: string; // 1–80 Zeichen; Rust bildet daraus einen sicheren Ordnernamen
  collection?: string;
}

export interface ProjectRef {
  projectId: ProjectId;
}

export interface ProjectFileReq {
  projectId: ProjectId;
  relPath: string; // wird in Rust mit safe_join gegen den Projektordner geprüft
}

export interface ProjectNewFileReq {
  projectId: ProjectId;
  templateId: TemplateId;
  fileName: string; // ohne Endung, z. B. "herbst-drop_signal"
}

export interface ProjectFile {
  projectId: ProjectId;
  ref: ProjectFileRef;
  handle: FileHandleInfo;
}

export interface ProjectSetCollectionReq {
  projectId: ProjectId;
  collection: string | null;
}

export interface ProjectOpenResult {
  /** "launched" = Programm gestartet; "module" = Frontend öffnet eigenes Modul. */
  outcome:
    | { kind: "launched"; launch: LaunchResult }
    | { kind: "module"; module: "mockup" | "social"; projectId: ProjectId; relPath: string }
    | { kind: "programMissing"; programId: ProgramId }; // Frontend bietet Installation an
}

/** Dokument der eigenen Module (Mockup/Social), Datei im Projekt (*.mockup.json, *.social.json). ≤ 1 MB. */
export interface ProjectDocument {
  schemaVersion: 1;
  module: "mockup" | "social";
  data: MockupDocument | SocialDocument;
}

export interface ProjectReadDocumentReq {
  projectId: ProjectId;
  relPath: string;
}

export interface ProjectWriteDocumentReq {
  projectId: ProjectId;
  relPath: string;
  document: ProjectDocument;
}

export interface ProjectAddAssetReq {
  projectId: ProjectId;
  handleId: FileHandleId; // Datei wird in <projekt>/<folder>/ kopiert
  folder?: ProjectFolder; // Standard "Motive"
}

export interface ProjectAsset {
  relPath: string; // "Motive/motiv-01.png"
  handle: FileHandleInfo;
}

/* ========================================================================== */
/* 9. Bibliothek (gemeinsamer Ordner, ohne Konten)                            */
/* ========================================================================== */

/** „Art“ in der Filterspalte, aus dem Dateityp abgeleitet. */
export type LibraryKind = "image" | "vector" | "model3d" | "video" | "audio" | "font" | "palette" | "document" | "other";
export type LibraryEntryStatus = "draft" | "approved" | "archived";
export type SyncTool = "syncthing" | "nextcloud" | "dropbox" | "googleDrive" | "oneDrive" | "iCloud" | "unknown";

export interface Collection {
  id: string; // "rauschen"
  name: string; // "Rauschen"
  hex: HexColor; // Farbquadrat in Listen
}

/** Ergebnis des Ordnerdialogs: Zusammenfassung vor der Bestätigung („3.104 Dateien · 41 GB · 12 Projekte“). */
export interface LibraryRootCandidate {
  candidateId: string;
  path: DisplayPath;
  fileCount: number;
  totalBytes: number;
  projectCount: number;
  initialized: boolean; // .cypher/library.json vorhanden
  syncTool: SyncTool | null;
  problems: ("notWritable" | "insideAppData" | "systemDirectory" | "veryLarge")[];
}

export interface LibraryUseRootReq {
  candidateId: string;
  initialize: boolean; // .cypher/ und Standardordner anlegen, falls nicht vorhanden
}

export interface LibraryStatus {
  configured: boolean;
  root: DisplayPath | null;
  initialized: boolean;
  formatVersion: number | null;
  entryCount: number;
  totalBytes: number;
  projectCount: number;
  conflictCount: number; // Konfliktkopien des Sync-Werkzeugs
  lastScanAt: IsoDateTime | null;
  syncTool: SyncTool | null; // erkannt anhand von Markerdateien, nur Anzeige
  watching: boolean;
  collections: Collection[]; // aus .cypher/library.json, Standard aus brand.json
}

export interface SidecarMeta {
  title: string;
  tags: string[];
  collection: string | null;
  author: string; // freier Text, kein Konto
  status: LibraryEntryStatus;
  notes: string;
  colors: HexColor[];
  printProfileId: PrintProfileId | null;
  garmentColorIds: GarmentColorId[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LibraryEntry {
  id: LibraryEntryId;
  kind: LibraryKind;
  relPath: string; // relativ zur Bibliothekswurzel, "/" als Trenner
  fileName: string;
  mime: string;
  size: number;
  modifiedAt: IsoDateTime;
  widthPx: number | null;
  heightPx: number | null;
  projectId: ProjectId | null; // liegt in Projekte/<Name>/
  openWith: ProgramId | null; // passendes Programm nach Dateityp
  meta: SidecarMeta;
  thumbnailUrl: AssetUrl | null; // auch für .kra, .svg, .blend (eingebettete Vorschau)
  conflict: { kind: "syncConflictCopy"; originalRelPath: string | null } | null;
  sidecarMissing: boolean; // noch keine Begleitdatei in .cypher/meta (wird beim ersten Bearbeiten angelegt)
}

export interface LibraryQuery {
  text?: string; // Name, Tags, Projekt
  kinds?: LibraryKind[];
  collections?: string[];
  tags?: string[];
  status?: LibraryEntryStatus[];
  projectId?: ProjectId;
  modifiedAfter?: IsoDateTime;
  onlyConflicts?: boolean;
  sort?: "modifiedDesc" | "nameAsc" | "kind" | "sizeDesc";
  offset?: number;
  limit?: number; // Standard 200, max. 1000 (Raster ist virtualisiert)
}

export interface LibraryFacets {
  kinds: Partial<Record<LibraryKind, number>>;
  collections: Record<string, number>;
  tags: Record<string, number>;
}

export interface LibraryPage {
  entries: LibraryEntry[];
  total: number;
  offset: number;
  facets: LibraryFacets; // Zahlen der Filterspalte für die aktuelle Abfrage
}

export interface LibraryGetReq {
  entryId: LibraryEntryId;
}

export interface LibraryMetaPatchReq {
  entryId: LibraryEntryId;
  patch: {
    title?: string;
    tags?: string[];
    collection?: string | null;
    author?: string;
    status?: LibraryEntryStatus;
    notes?: string;
    colors?: HexColor[];
    printProfileId?: PrintProfileId | null;
    garmentColorIds?: GarmentColorId[];
  };
}

/** Mehrfachauswahl: „Tags setzen“, „Kollektion“. */
export interface LibraryBulkMetaReq {
  entryIds: LibraryEntryId[];
  addTags?: string[];
  removeTags?: string[];
  collection?: string | null;
}

export interface LibraryImportReq {
  handleIds: FileHandleId[];
  subfolder?: string; // relativ zur Wurzel, wird validiert
  meta?: { tags?: string[]; author?: string; collection?: string; status?: LibraryEntryStatus };
}

export interface LibrarySetCollectionsReq {
  collections: Collection[];
}

export type ScanEvent =
  | { type: "started"; jobId: JobId }
  | { type: "progress"; scanned: number; found: number }
  | { type: "finished"; status: LibraryStatus };

export interface PackExportReq {
  entryIds: LibraryEntryId[];
  title: string;
  includeSidecars?: boolean; // Standard true
}

export type PackEvent =
  | { type: "started"; jobId: JobId; total: number }
  | { type: "progress"; done: number; total: number }
  | { type: "finished" };

export interface PackPreviewEntry {
  relPath: string;
  kind: LibraryKind;
  size: number;
  state: "new" | "identical" | "conflict"; // conflict = gleicher Pfad, anderer Inhalt
}

export interface PackPreview {
  handleId: FileHandleId;
  formatVersion: number;
  title: string;
  createdBy: string;
  createdAt: IsoDateTime;
  appVersion: SemVer;
  entries: PackPreviewEntry[];
  totalBytes: number;
}

export type PackConflictPolicy = "skip" | "keepBoth" | "overwrite";

export interface PackInspectReq {
  handleId: FileHandleId;
}

export interface PackImportReq {
  handleId: FileHandleId;
  conflictPolicy: PackConflictPolicy;
}

export interface PackImportReport {
  imported: number;
  skipped: number;
  renamed: number; // keepBoth
  overwritten: number; // überschrieben; Vorversion liegt in .cypher/trash/
}

/* ========================================================================== */
/* 10. Druckprüfer (Werte: docs/research/vorgaben.md, Abschnitte 0, 1, 5)     */
/* ========================================================================== */

export type Severity = "info" | "warning" | "error";

/** Entspricht Shirtigo `processingarea_type` (front, back, sleeve-left, sleeve-right, back-inside). */
export type PrintPlacement = "front" | "back" | "sleeveLeft" | "sleeveRight" | "backInside";
export type PrintTechnique = "dtg" | "dtf";
export type ColorProfileKind = "srgb" | "adobeRgb" | "displayP3" | "gray" | "cmyk" | "other" | "none";
/** Fachbegriffe der Farbräume; Shirtigo empfiehlt Adobe RGB (1998), akzeptiert sRGB. */
export type ExportColorProfile = "adobeRgb" | "srgb";

export interface PrintWidthPreset {
  id: string; // "chestEmblem", "chestCentered", "backShoulder"
  label: string; // "Brust zentriert"
  widthMm: number; // 280
  maxWidthMm: number | null; // 150 beim Brustemblem
}

export interface PrintProfile {
  id: PrintProfileId; // "shirtigo-tee-front"
  provider: "shirtigo";
  product: { id: "tee" | "hoodie"; providerProductId: string; label: string }; // "organic-shirt", "Organic Shirt (Creator 2.0, STTU169)"
  placement: PrintPlacement;
  techniques: PrintTechnique[]; // Ärmel/Nacken nur ["dtf"]
  title: string; // "T-Shirt Vorderseite"
  printAreaMm: { width: number; height: number }; // 330 × 450 (Maximum der Fläche)
  safeAreaMm: { width: number; height: number } | null; // 280 × 360: keine Verkleinerung auf kleinen Größen
  topMarginHintMm: number | null; // nur Hinweis, nicht prüfen
  widthPresets: PrintWidthPreset[];
  defaultWidthMm: number;
  targetDpi: number; // 300 (darunter Warnung)
  errorBelowDpi: number; // 150
  minPxPerSide: number; // 1000, gemessen nach Zuschnitt auf sichtbare Pixel
  maxPxPerSide: number; // 10500
  warnFileBytes: number; // 48 MB
  maxFileBytes: number; // 64 MB
  acceptedUploadFormats: ("png" | "jpeg")[];
  color: { exportProfile: ExportColorProfile; acceptedProfiles: ExportColorProfile[] };
  alpha: {
    semiMin: number; // 13  (5 %)
    semiMax: number; // 252 (99 %)
    ghostMax: number; // 12: Alpha 1..12 außerhalb des Motivrahmens = Geisterpixel
    edgeRadiusPx: number; // 2: Anti-Aliasing-Saum zählt nicht als Halbtransparenz
    warnShare: number; // 0.001 (Anteil flächiger Halbtransparenz an sichtbaren Pixeln)
    errorShare: number; // 0.01
    severityOnLightGarment: Severity; // "info" (weißes Textil, keine Unterlage)
    severityForDtf: Severity; // "error"
  };
  strokes: { warnBelowPx: number; criticalBelowPx: number }; // 10 px (0,8 mm), 5 px (0,4 mm)
  source: { urls: string[]; checkedAt: IsoDateTime | null };
  assumption: boolean; // true, solange Teilwerte unbelegt sind (Testdruck ausstehend) → UI-Hinweis
}

export type PrintRuleId =
  | "format.unreadable"
  | "format.notUploadable" // TIFF/WebP: Export wandelt in PNG
  | "format.jpegNoAlpha"
  | "format.animated" // APNG
  | "format.interlaced"
  | "format.bitDepth16"
  | "format.indexed"
  | "size.belowMinPixels" // beide Seiten < min → error, eine Seite → warning
  | "size.aboveMaxPixels"
  | "file.tooLarge" // > warnFileBytes → warning, > maxFileBytes → error
  | "resolution.tooLow"
  | "resolution.belowTarget"
  | "resolution.metadataMismatch" // pHYs fehlt oder ≠ 11811 px/m
  | "resolution.upscaleNeeded"
  | "layout.empty"
  | "layout.exceedsPrintArea"
  | "layout.exceedsSafeArea"
  | "layout.touchesEdge"
  | "color.cmyk"
  | "color.noProfile"
  | "color.unsupportedProfile"
  | "color.profileDiffers" // z. B. sRGB, Export rechnet in Adobe RGB um
  | "color.grayscale"
  | "color.nearBlack" // fast Schwarz bekommt Unterlage, nur #000000 nicht
  | "alpha.missing" // kein Alphakanal → Rechteck wird gedruckt
  | "alpha.opaqueBackground"
  | "alpha.semiTransparent"
  | "alpha.ghostPixels"
  | "detail.thinLines"
  | "contrast.lowOnGarment";

export interface Finding {
  ruleId: PrintRuleId;
  severity: Severity;
  /** Zahlen/Texte für den deutschen Text im Frontend, z. B. { effectiveDpi: 212, targetDpi: 300 } */
  params: Record<string, number | string | boolean>;
  region: Rect | null; // betroffener Bereich in Bildpixeln (für Overlay)
  fix: "cleanGhostPixels" | "semiTransparency" | "nearBlackToPureBlack" | "colorProfile" | null; // passende Export-Korrektur
}

export interface PrintReport {
  engineVersion: string; // Regelwerk, z. B. "1.0.0"
  analyzedAt: IsoDateTime;
  file: {
    name: string;
    format: "png" | "tiff" | "jpeg" | "webp" | "other";
    widthPx: number;
    heightPx: number;
    bitDepth: 8 | 16 | 32;
    channels: "gray" | "grayAlpha" | "rgb" | "rgba" | "cmyk" | "indexed";
    interlaced: boolean;
    animated: boolean;
    fileBytes: number;
  };
  dpi: { x: number; y: number; source: "pHYs" | "tiffTags" | "jfif" | "exif" | "none" };
  color: { profile: ColorProfileKind; iccDescription: string | null; srgbChunk: boolean };
  alpha: {
    present: boolean;
    transparentShare: number; // a = 0, Anteil an allen Pixeln
    opaqueShare: number; // a = 255
    semiShareOfVisible: number; // semiMin ≤ a ≤ semiMax, roh (inkl. Kantensaum), Anteil an a > 0
    semiAreaShareOfVisible: number; // nach Abzug des Kantensaums (vorgaben.md 5.4) – maßgeblich
    ghostPixelCount: number;
  };
  bounds: Rect | null; // Hüllrechteck aller Pixel mit a ≥ semiMin; null = leer
  marginsPx: { top: number; right: number; bottom: number; left: number } | null;
  trimmedPx: Size | null; // Größe nach Zuschnitt (so misst Shirtigo)
  profileId: PrintProfileId;
  technique: PrintTechnique;
  garment: { colorId: GarmentColorId; underbase: boolean } | null;
  placement: {
    plannedWidthMm: number;
    plannedHeightMm: number; // aus Seitenverhältnis
    effectiveDpi: number; // trimmedPx.width / (plannedWidthMm / 25.4)
    maxWidthMmAtTargetDpi: number; // größte Druckbreite ohne Unterschreiten von targetDpi
    targetPx: Size; // Ausgabegröße bei targetDpi (zugeschnitten)
    fitsPrintArea: boolean;
    fitsSafeArea: boolean | null;
  };
  minStrokePx: number | null; // dünnste gefundene Linie (Phase 3), null = nicht geprüft
  findings: Finding[];
  verdict: "ok" | "warning" | "error";
}

export interface PrintAnalyzeReq {
  handleId: FileHandleId;
  profileId: PrintProfileId;
  garmentColorId?: GarmentColorId;
  technique?: PrintTechnique; // Standard: erstes Verfahren des Profils
  plannedWidthMm?: number; // Standard: profile.defaultWidthMm
}

export type SemiTransparencyFix = "keep" | "threshold" | "blendWithGarment" | "halftone";

export interface PrintExportOptions {
  /** trimmed = Motiv ohne Rand + Begleitdatei (Breite/Versatz in mm);
   *  fullArea = Leinwand in Größe der Druckfläche (z. B. 3898 × 5315), für extract_size_and_position. */
  mode: "trimmed" | "fullArea";
  plannedWidthMm: number;
  offsetTopMm: number; // fullArea: Lage in der Leinwand; trimmed: nur Begleitdatei
  offsetCenterMm: number; // Versatz von der Mitte (negativ = links)
  allowUpscale: boolean; // Standard false
  colorProfile: ExportColorProfile; // Standard aus Profil (Shirtigo: adobeRgb)
  fixes: {
    cleanGhostPixels: boolean;
    semiTransparency: SemiTransparencyFix; // halftone ab Phase 3+
    nearBlackToPureBlack: boolean;
  };
  writePlacementJson: boolean; // <name>.shirtigo.json neben der PNG
  destination: { kind: "dialog" } | { kind: "besideSource" } | { kind: "library" } | { kind: "project"; projectId: ProjectId }; // project → Export/Druck
}

export interface PrintExportReq {
  handleId: FileHandleId;
  profileId: PrintProfileId;
  garmentColorId?: GarmentColorId; // nötig für blendWithGarment
  technique?: PrintTechnique;
  options: PrintExportOptions;
}

export type PrintExportEvent =
  | { type: "started"; jobId: JobId }
  | { type: "stage"; stage: "decode" | "analyze" | "fix" | "resample" | "colorConvert" | "encode" | "verify" }
  | { type: "finished" };

export interface PrintExportResult {
  output: FileHandleInfo;
  placementJson: FileHandleInfo | null;
  widthPx: number;
  heightPx: number;
  dpi: number;
  colorProfile: ExportColorProfile;
  report: PrintReport; // erneute Prüfung der erzeugten Datei
}

export interface PrintOverlayReq {
  handleId: FileHandleId;
  profileId: PrintProfileId;
  overlay: "semiTransparent" | "ghostPixels" | "bounds" | "thinLines" | "alphaOnly";
}

/* ========================================================================== */
/* 11. Marke, Mockup, Social                                                  */
/* ========================================================================== */

export interface GarmentColor {
  id: GarmentColorId;
  name: string; // "Schwarz"
  hex: HexColor; // Kollektionsfarbe (Marke), z. B. "#141210"
  textileHex: HexColor; // reale Produktfarbe beim Druckanbieter, für Mockups (vorgaben.md 1.10)
  providerColorName: string | null; // "Black", "French Navy" …
  heather: boolean; // meliert → Strukturebene
  underbase: boolean; // false nur bei weißem Textil (keine weiße Unterlage)
  textOnGarment: HexColor; // Kontrastfarbe für Hinweise in der UI
}

export interface PaletteColor {
  name: string;
  hex: HexColor;
}

export interface Palette {
  id: string; // "cypher-textil", "cypher-motiv"
  name: string;
  colors: PaletteColor[];
}

export interface BrandFont {
  family: string;
  usage: "display" | "text" | "pixel" | "mono";
  license: "OFL-1.1";
  files: { url: AssetUrl; weight: number; style: "normal" | "italic" }[];
}

export interface Brand {
  collections: Collection[]; // Standard-Kollektionen (Rauschen, Mittelwelle, Gold-Lounge …)
  garmentColors: GarmentColor[];
  palettes: Palette[];
  fonts: BrandFont[];
  logos: { id: string; variant: "light" | "dark"; url: AssetUrl }[];
}

/** Viereck der Druckfläche im Vorlagenbild: oben links, oben rechts, unten rechts, unten links (Parallelogramm). */
export type Quad = [Point, Point, Point, Point];

export interface MockupLayerSet {
  mask: AssetUrl; // Alpha = Textilfläche
  shade: AssetUrl; // Graustufen aus eigenem Foto, multiply (Falten/Schatten)
  light: AssetUrl; // Graustufen auf Schwarz, screen (Glanzlichter)
  displace: AssetUrl | null; // R = dx, G = dy (128 = 0)
  texture: AssetUrl | null; // optionale CC0-Stoffstruktur (z. B. Poly Haven cotton_jersey)
  heather: AssetUrl | null; // Melange-Struktur für heather-Farben
  background: AssetUrl | null;
}

export interface MockupTemplate {
  id: MockupTemplateId;
  title: string;
  product: "tee" | "hoodie";
  view: "front" | "back";
  canvas: Size; // z. B. 2400 × 3000
  printProfileId: PrintProfileId; // liefert die Druckfläche in mm
  printArea: { quad: Quad }; // Druckfläche in Pixeln der Vorlage
  displaceStrengthPx: number;
  /** "light" = Aufnahme eines hellen Shirts, "dark" = eigene Aufnahme eines dunklen (reines Multiplizieren wirkt bei Schwarz flach). */
  variants: { exposure: "light" | "dark"; layers: MockupLayerSet; colorIds: GarmentColorId[] }[];
}

export interface MockupDocument {
  templateId: MockupTemplateId;
  colorId: GarmentColorId;
  design: { relPath: string } | null; // Projekt-Asset
  placement: { widthMm: number; offsetTopMm: number; offsetCenterMm: number }; // wie Shirtigo
  background: { kind: "transparent" } | { kind: "color"; hex: HexColor } | { kind: "template" };
  exportSizePx: Size;
}

export type SocialFormat = "post" | "postTall" | "story" | "reelCover";

export const SOCIAL_FORMAT_SIZES: Record<SocialFormat, Size> = {
  post: { width: 1080, height: 1350 }, // 4:5
  postTall: { width: 1080, height: 1440 }, // 3:4, füllt das hohe Profilraster
  story: { width: 1080, height: 1920 }, // auch Reel-Videoformat (Kdenlive)
  reelCover: { width: 1080, height: 1920 },
};

/** Hilfslinien (vorgaben.md 2.1/2.2). Nur Anzeige im Editor, nie exportiert. */
export const SOCIAL_GUIDES = {
  verticalConservative: { top: 270, bottom: 672, left: 120, right: 120 }, // Instagram + TikTok gemeinsam
  instagramVertical: { top: 269, bottom: 672, left: 65, right: 65 }, // Meta: 14 % / 35 % / 6 %
  reelCoverGridBox: { x: 0, y: 240, width: 1080, height: 1440 }, // 3:4-Ausschnitt im Profilraster
  postGridKeepX: { from: 34, to: 1046 }, // 4:5-Post im 3:4-Raster
} as const;

export type Fill =
  | { type: "solid"; color: HexColor }
  | { type: "linearGradient"; angleDeg: number; stops: { at: number; color: HexColor }[] }
  | { type: "image"; url: AssetUrl; fit: "cover" | "contain" };

export type SocialLayer =
  | { type: "image"; id: string; slot: string; rect: Rect; fit: "cover" | "contain"; radiusPx: number; required: boolean }
  | {
      type: "text";
      id: string;
      slot: string;
      rect: Rect;
      fontFamily: string;
      fontWeight: number;
      sizePx: number;
      minSizePx: number; // Auto-Verkleinerung bis hierhin, dann Kürzung mit …
      lineHeight: number;
      letterSpacingEm: number;
      color: HexColor;
      align: "left" | "center" | "right";
      valign: "top" | "middle" | "bottom";
      transform: "none" | "uppercase";
      maxLines: number;
      defaultText: string;
    }
  | { type: "shape"; id: string; rect: Rect; fill: Fill; radiusPx: number; opacity: number }
  | { type: "logo"; id: string; rect: Rect; variant: "light" | "dark" }
  | { type: "grain"; id: string; opacity: number; seed: number }
  | { type: "scanlines"; id: string; opacity: number; spacingPx: number };

export interface SocialTemplate {
  id: SocialTemplateId;
  title: string;
  format: SocialFormat;
  size: Size;
  background: Fill;
  layers: SocialLayer[];
  safeZones: Rect[]; // aus SOCIAL_GUIDES abgeleitet, je Vorlage überschreibbar
  gridCrop: Rect | null; // Reel-Cover/Post: Ausschnitt im Profilraster
  previewUrl: AssetUrl | null;
}

export interface SocialDocument {
  templateId: SocialTemplateId;
  format: SocialFormat;
  texts: Record<string, string>; // slot → Text
  images: Record<string, { relPath: string; focal: Point } | null>; // slot → Projekt-Asset
  colorOverrides: Record<string, HexColor>; // layerId → Farbe
  exportFormat: "png" | "jpeg"; // JPEG-Qualität 0,90
}

/* ========================================================================== */
/* 12. App-Update, Aufträge (Jobs), Beispieldateien, Fenster schließen        */
/* ========================================================================== */

export interface UpdateCheck {
  available: boolean;
  currentVersion: SemVer;
  version: SemVer | null;
  date: IsoDateTime | null;
  notes: string | null; // Markdown aus dem Release, im Frontend als reiner Text dargestellt
  checkedAt: IsoDateTime;
}

export type UpdateEvent =
  | { type: "started"; jobId: JobId; contentLength: number | null }
  | { type: "progress"; downloadedBytes: number; contentLength: number | null }
  | { type: "installing" }; // danach Neustart durch Rust

export type JobKind =
  | "install"
  | "setupApply"
  | "setupUndo"
  | "libraryScan"
  | "packExport"
  | "packImport"
  | "printExport"
  | "appUpdate"
  | "bgremoveModel"
  | "bgremoveRun";

/** Ein laufender Auftrag (Popover „Aufträge“, Strg+J). Fortschritt kommt über jobs:changed (≤ 2/s). */
export interface JobInfo {
  id: JobId;
  kind: JobKind;
  subject: string; // z. B. Programmname oder Dateiname
  startedAt: IsoDateTime;
  cancellable: boolean;
  progress: number | null; // 0..1, null = unbestimmt
  phase: string | null; // Code, z. B. "download", "extract" (Text im Frontend)
  needsAttention: boolean; // Bernstein-Lampe: wartet auf den Nutzer (z. B. Konflikt)
}

/** Abgeschlossener Auftrag; die letzten 24 h werden lokal gespeichert (max. 200). */
export interface JobRecord {
  info: JobInfo;
  finishedAt: IsoDateTime;
  outcome: "succeeded" | "failed" | "cancelled";
  error: AppError | null;
  result:
    | { kind: "file"; handle: FileHandleInfo }
    | { kind: "installation"; installationId: InstallationId }
    | { kind: "setup"; setupId: SetupId }
    | { kind: "none" };
}

export interface JobCancelReq {
  jobId: JobId;
}

export interface AppCloseReq {
  /**
   * true = laufende Jobs abbrechen (Aufräumen läuft, Rust wartet bis zu 10 s), dann beenden.
   * false = bei laufenden Jobs Fehler `busy { jobRunning }`, die App bleibt offen (0.3.0: so gebaut, hier festgehalten).
   */
  force: boolean;
}

/** Mitgelieferte Beispieldateien, z. B. Probe-Motiv für den Probelauf im Erststart. */
export interface SampleInfo {
  id: string; // "probe-motiv"
  title: string;
  description: string;
  handle: FileHandleInfo;
}

/* ========================================================================== */
/* 13. Hintergrundentfernung (Farbschlüssel ab Phase 3, Modell Phase 5)       */
/* ========================================================================== */

export interface BgRemoveModelInfo {
  id: string; // "isnet-general-use"
  name: string;
  license: LicenseInfo; // Apache-2.0
  size: number;
  installed: boolean;
  notice: string | null; // z. B. Hinweis zu Trainingsdaten (vorgaben.md 3.2)
}

export interface BgRemoveStatus {
  colorKeyAvailable: boolean; // ohne KI, für flächige Grafiken (immer true ab Phase 3)
  modelFeature: boolean; // Build mit Cargo-Feature "bgremove"
  runtimeInstalled: boolean; // ONNX-Runtime-Bibliothek (load-dynamic) geladen
  models: BgRemoveModelInfo[];
}

export type BgRemoveMethod =
  | { kind: "colorKey"; tolerance: number; sample: "corners" | "border" } // tolerance 0..100
  | { kind: "model"; modelId: string; refineEdges: boolean };

export interface BgRemoveModelReq {
  modelId: string;
}

export interface BgRemoveRunReq {
  handleId: FileHandleId;
  method: BgRemoveMethod;
}

export type BgRemoveEvent =
  | { type: "started"; jobId: JobId }
  | { type: "stage"; stage: "load" | "infer" | "compose" | "encode" }
  | { type: "finished" };

/* ========================================================================== */
/* 14. Command-Tabelle                                                        */
/* ========================================================================== */

type NoArgs = Record<string, never>;
type Req<T> = { req: T };
type ReqCh<T, E> = { req: T; onEvent: IpcChannel<E> };
type Ch<E> = { onEvent: IpcChannel<E> };

/** Alle JSON-Commands. Schlüssel = Command-Name, args = zweites Argument von invoke(). */
export interface Commands {
  // --- app / settings / network / diagnostics
  app_info: { args: NoArgs; result: AppInfo };
  app_open_external: { args: Req<OpenExternalReq>; result: null };
  app_reveal: { args: Req<RevealReq>; result: null };
  app_close: { args: Req<AppCloseReq>; result: null };
  settings_get: { args: NoArgs; result: Settings };
  settings_update: { args: Req<SettingsPatch>; result: Settings };
  settings_choose_dir: { args: Req<SettingsChooseDirReq>; result: Settings | null };
  network_info: { args: NoArgs; result: NetworkInfo };
  diagnostics_export: { args: NoArgs; result: FileHandleInfo | null };

  // --- catalog
  catalog_status: { args: NoArgs; result: CatalogStatus };
  catalog_refresh: { args: NoArgs; result: CatalogRefreshResult };

  // --- programs / install / launch
  programs_list: { args: NoArgs; result: ProgramsView };
  programs_rescan: { args: NoArgs; result: ProgramsView };
  program_set_preferred: { args: Req<SetPreferredReq>; result: ProgramOverview };
  program_add_manual: { args: Req<AddManualReq>; result: Installation | null };
  install_preview: { args: Req<InstallPreviewReq>; result: InstallPlan };
  install_start: { args: ReqCh<InstallStartReq, InstallEvent>; result: Installation };
  installation_remove: { args: Req<InstallationRemoveReq>; result: null };
  program_launch: { args: Req<LaunchReq>; result: LaunchResult };

  // --- setup
  setup_packs_list: { args: NoArgs; result: SetupSummary[] };
  setup_status: { args: Req<SetupStatusReq>; result: SetupSummary };
  setup_preview: { args: Req<SetupPreviewReq>; result: SetupPlan };
  setup_apply: { args: ReqCh<SetupApplyReq, SetupEvent>; result: SetupRecord };
  setup_undo: { args: Req<SetupUndoReq>; result: UndoReport };
  setup_history: { args: Req<SetupHistoryReq>; result: SetupRecord[] };

  // --- files / samples
  file_pick: { args: Req<FilePickReq>; result: FileHandleInfo[] };
  samples_list: { args: NoArgs; result: SampleInfo[] };

  // --- projects / templates
  templates_list: { args: NoArgs; result: TemplateInfo[] };
  projects_list: { args: NoArgs; result: Project[] };
  project_create: { args: Req<ProjectCreateReq>; result: Project };
  project_new_file: { args: Req<ProjectNewFileReq>; result: ProjectFile };
  project_open_file: { args: Req<ProjectFileReq>; result: ProjectOpenResult };
  project_open_last: { args: Req<ProjectRef>; result: ProjectOpenResult };
  project_file_handle: { args: Req<ProjectFileReq>; result: FileHandleInfo };
  project_set_collection: { args: Req<ProjectSetCollectionReq>; result: Project };
  project_forget: { args: Req<ProjectRef>; result: null };
  project_read_document: { args: Req<ProjectReadDocumentReq>; result: ProjectDocument | null };
  project_write_document: { args: Req<ProjectWriteDocumentReq>; result: ProjectFileRef };
  project_add_asset: { args: Req<ProjectAddAssetReq>; result: ProjectAsset };

  // --- library
  library_status: { args: NoArgs; result: LibraryStatus };
  library_choose_root: { args: NoArgs; result: LibraryRootCandidate | null };
  library_use_root: { args: Req<LibraryUseRootReq>; result: LibraryStatus };
  library_scan: { args: Ch<ScanEvent>; result: LibraryStatus };
  library_query: { args: Req<LibraryQuery>; result: LibraryPage };
  library_get: { args: Req<LibraryGetReq>; result: LibraryEntry };
  library_update_meta: { args: Req<LibraryMetaPatchReq>; result: LibraryEntry };
  library_bulk_meta: { args: Req<LibraryBulkMetaReq>; result: number };
  library_import: { args: Req<LibraryImportReq>; result: LibraryEntry[] };
  library_entry_handle: { args: Req<LibraryGetReq>; result: FileHandleInfo };
  library_set_collections: { args: Req<LibrarySetCollectionsReq>; result: LibraryStatus };
  library_thumbnails_clear: { args: NoArgs; result: null };
  library_pack_export: { args: ReqCh<PackExportReq, PackEvent>; result: FileHandleInfo | null };
  library_pack_inspect: { args: Req<PackInspectReq>; result: PackPreview };
  library_pack_import: { args: ReqCh<PackImportReq, PackEvent>; result: PackImportReport };

  // --- printcheck
  print_profiles_list: { args: NoArgs; result: PrintProfile[] };
  printcheck_analyze: { args: Req<PrintAnalyzeReq>; result: PrintReport };
  printcheck_export: { args: ReqCh<PrintExportReq, PrintExportEvent>; result: PrintExportResult };
  printcheck_overlay: { args: Req<PrintOverlayReq>; result: FileHandleInfo };

  // --- brand / mockup / social (Rendering im Frontend)
  brand_get: { args: NoArgs; result: Brand };
  mockup_templates_list: { args: NoArgs; result: MockupTemplate[] };
  social_templates_list: { args: NoArgs; result: SocialTemplate[] };

  // --- updater
  app_update_check: { args: NoArgs; result: UpdateCheck };
  app_update_install: { args: Ch<UpdateEvent>; result: null };

  // --- jobs
  jobs_active: { args: NoArgs; result: JobInfo[] };
  jobs_recent: { args: NoArgs; result: JobRecord[] };
  job_cancel: { args: Req<JobCancelReq>; result: boolean };

  // --- bgremove (colorKey ab Phase 3; Modell-Commands ab Phase 5 mit Cargo-Feature "bgremove")
  bgremove_status: { args: NoArgs; result: BgRemoveStatus };
  bgremove_model_preview: { args: Req<BgRemoveModelReq>; result: InstallPlan };
  bgremove_model_install: { args: ReqCh<InstallStartReq, InstallEvent>; result: BgRemoveStatus };
  bgremove_run: { args: ReqCh<BgRemoveRunReq, BgRemoveEvent>; result: FileHandleInfo };
}

/** Commands mit Binärkörper statt JSON-Argumenten (tauri::ipc::Request). */
export interface RawCommands {
  export_save_image: { body: Uint8Array; meta: ExportImageMeta; result: FileHandleInfo | null };
}

export type CommandName = keyof Commands;
export type RawCommandName = keyof RawCommands;
export type CommandArgs<K extends CommandName> = Commands[K]["args"];
export type CommandResult<K extends CommandName> = Commands[K]["result"];

/** Signatur des typisierten Wrappers in apps/desktop/src/ipc/commands.ts. */
export type TypedInvoke = <K extends CommandName>(cmd: K, args: CommandArgs<K>) => Promise<CommandResult<K>>;

/* ========================================================================== */
/* 15. Globale Events (app.emit / listen)                                     */
/* ========================================================================== */

export interface EventMap {
  "catalog:updated": CatalogStatus;
  "programs:changed": { reason: "installed" | "removed" | "rescanned" | "setupChanged" | "preferredChanged" | "catalogChanged" };
  "library:changed": { reason: "watcher" | "import" | "scan" | "meta" | "packImport" | "rootChanged"; changedCount: number };
  "projects:changed": { projectId: ProjectId | null };
  /** `position` in logischen CSS-Pixeln des Fensters (0.3.0: Rust rechnet die physische Position um). */
  "files:dropped": { handles: FileHandleInfo[]; position: Point };
  "update:available": UpdateCheck;
  "app:closeRequested": { activeJobs: JobInfo[] };
  "jobs:changed": { active: JobInfo[]; finished: JobRecord | null };
}

export type EventName = keyof EventMap;

/* ========================================================================== */
/* 16. Laufzeit-Listen (für Mocks und Vollständigkeitstests)                  */
/* ========================================================================== */

export const COMMAND_NAMES = [
  "app_info",
  "app_open_external",
  "app_reveal",
  "app_close",
  "settings_get",
  "settings_update",
  "settings_choose_dir",
  "network_info",
  "diagnostics_export",
  "catalog_status",
  "catalog_refresh",
  "programs_list",
  "programs_rescan",
  "program_set_preferred",
  "program_add_manual",
  "install_preview",
  "install_start",
  "installation_remove",
  "program_launch",
  "setup_packs_list",
  "setup_status",
  "setup_preview",
  "setup_apply",
  "setup_undo",
  "setup_history",
  "file_pick",
  "samples_list",
  "templates_list",
  "projects_list",
  "project_create",
  "project_new_file",
  "project_open_file",
  "project_open_last",
  "project_file_handle",
  "project_set_collection",
  "project_forget",
  "project_read_document",
  "project_write_document",
  "project_add_asset",
  "library_status",
  "library_choose_root",
  "library_use_root",
  "library_scan",
  "library_query",
  "library_get",
  "library_update_meta",
  "library_bulk_meta",
  "library_import",
  "library_entry_handle",
  "library_set_collections",
  "library_thumbnails_clear",
  "library_pack_export",
  "library_pack_inspect",
  "library_pack_import",
  "print_profiles_list",
  "printcheck_analyze",
  "printcheck_export",
  "printcheck_overlay",
  "brand_get",
  "mockup_templates_list",
  "social_templates_list",
  "app_update_check",
  "app_update_install",
  "jobs_active",
  "jobs_recent",
  "job_cancel",
  "bgremove_status",
  "bgremove_model_preview",
  "bgremove_model_install",
  "bgremove_run",
] as const satisfies readonly CommandName[];

export const RAW_COMMAND_NAMES = ["export_save_image"] as const satisfies readonly RawCommandName[];

export const EVENT_NAMES = [
  "catalog:updated",
  "programs:changed",
  "library:changed",
  "projects:changed",
  "files:dropped",
  "update:available",
  "app:closeRequested",
  "jobs:changed",
] as const satisfies readonly EventName[];

/* Compile-Zeit-Prüfung: COMMAND_NAMES und EVENT_NAMES sind vollständig. */
type MissingCommands = Exclude<CommandName, (typeof COMMAND_NAMES)[number]>;
type MissingEvents = Exclude<EventName, (typeof EVENT_NAMES)[number]>;
export const __contractComplete: [MissingCommands, MissingEvents] extends [never, never] ? true : never = true;
