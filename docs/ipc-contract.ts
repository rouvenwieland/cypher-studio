/**
 * Cypher Studio – IPC-Vertrag zwischen Rust-Kern (Team A) und Frontend (Team B)
 * ============================================================================
 * Stand 16.10.2026 · Vertragsversion 0.1.0 · gehört zu docs/ARCHITEKTUR.md, Abschnitt 3
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

export const IPC_CONTRACT_VERSION = "0.1.0" as const;

/* ========================================================================== */
/* 0. Grundtypen                                                              */
/* ========================================================================== */

export type IsoDateTime = string; // RFC 3339, UTC, z. B. "2026-10-16T18:30:00Z"
export type Sha256Hex = string; // 64 Zeichen, Kleinbuchstaben
export type SemVer = string; // "4.5.3", "0.1.0-beta.2"
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
export type PrintProfileId = string; // "shirtigo-dtg-front"
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
  | "artifact";

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
/* 2. App, Einstellungen, Diagnose                                            */
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
  | { kind: "libraryEntry"; entryId: LibraryEntryId }
  | { kind: "libraryRoot" }
  | { kind: "fileHandle"; handleId: FileHandleId }
  | { kind: "logs" }
  | { kind: "setupBackups"; programId: ProgramId };

export interface Settings {
  schemaVersion: 1;
  updates: { autoCheck: boolean };
  catalog: { autoRefresh: boolean };
  programsDir: DisplayPath; // Ziel für portable Installationen (ändern über settings_choose_dir)
  projectsDir: DisplayPath; // Standard: <Dokumente>/Cypher Studio/Projekte
  libraryRoot: DisplayPath | null; // ändern über library_choose_root
  downloads: { keepCache: boolean; maxParallel: 1 | 2 | 3 };
  linux: { appImageMode: "auto" | "extract" | "direct" };
  appearance: { theme: "system" | "light" | "dark"; reducedMotion: "system" | "on" | "off" };
  profile: { displayName: string }; // nur lokal; Autorenfeld in Bibliothek/Austauschpaketen
}

export interface SettingsPatch {
  updates?: { autoCheck?: boolean };
  catalog?: { autoRefresh?: boolean };
  downloads?: { keepCache?: boolean; maxParallel?: 1 | 2 | 3 };
  linux?: { appImageMode?: "auto" | "extract" | "direct" };
  appearance?: { theme?: "system" | "light" | "dark"; reducedMotion?: "system" | "on" | "off" };
  profile?: { displayName?: string };
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

/* ========================================================================== */
/* 3. Katalog                                                                 */
/* ========================================================================== */

export interface CatalogStatus {
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
  | { kind: "staleCatalogVersion"; latest: SemVer }; // nur Hinweis "Update verfügbar"

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

export interface ProgramRelease {
  version: SemVer;
  channel: "stable" | "lts";
  releasedAt: IsoDateTime | null;
  downloadSize: number;
  availableForThisPlatform: boolean;
}

export type SetupStatus = "notApplied" | "applied" | "outdated" | "partial" | "unsupported";

export interface SetupScope {
  scopeId: SetupScopeId;
  /** userProfile = Benutzerprofil, gilt für alle System-Installationen; portableInstall = Konfiguration im Programmordner */
  scopeKind: "userProfile" | "portableInstall" | "flatpakProfile" | "snapProfile" | "userFonts";
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
  url: string; // Anzeige
  signerFingerprints: string[]; // PGP: 40 Hex-Zeichen; minisign: Key-ID
}

export interface InstallPreviewReq {
  programId: ProgramId;
  version?: SemVer; // fehlt = neueste für diese Plattform
}

export interface InstallPlan {
  planId: PlanId;
  programId: ProgramId;
  programName: string;
  version: SemVer;
  channel: "stable" | "lts";
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
/* 6. Cypher-Einrichtung                                                      */
/* ========================================================================== */

export interface SetupPreviewReq {
  packId: PackId;
  scopeId: SetupScopeId;
}

export type SetupOperationKind =
  | "create" // Datei neu
  | "update" // eigene Datei aus früherer Einrichtung, wird ersetzt
  | "skip" // identisch vorhanden
  | "backupAndReplace" // fremde/geänderte Datei: wird gesichert und ersetzt
  | "installFont"
  | "blenderExtension"; // blender --command extension install-file …

export interface SetupOperation {
  kind: SetupOperationKind;
  target: DisplayPath;
  sourceId: string; // Datei-ID im Paket-Manifest
  bytes: number;
}

export interface SetupPlan {
  planId: PlanId;
  packId: PackId;
  programId: ProgramId | null;
  scopeId: SetupScopeId;
  packVersion: SemVer;
  previous: SetupRecord | null;
  operations: SetupOperation[];
  counts: { create: number; update: number; skip: number; backupAndReplace: number };
  requiresProgramClosed: boolean; // Programm läuft gerade → Hinweis "bitte schließen"
  programRunning: boolean;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export interface SetupApplyReq {
  planId: PlanId;
}

export type SetupEvent =
  | { type: "started"; jobId: JobId; total: number }
  | { type: "step"; index: number; total: number; operation: SetupOperation }
  | { type: "finished"; record: SetupRecord };

export interface SetupRecord {
  setupId: SetupId;
  packId: PackId;
  programId: ProgramId | null;
  scopeId: SetupScopeId;
  packVersion: SemVer;
  appliedAt: IsoDateTime;
  status: "applied" | "partial" | "undone";
  filesWritten: number;
  backupsTaken: number;
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
}

export interface SetupStatusReq {
  packId: PackId;
}

/* ========================================================================== */
/* 7. Dateien (Handles statt Pfade)                                           */
/* ========================================================================== */

export type FilePurpose = "printcheck" | "mockupDesign" | "socialImage" | "libraryImport" | "packImport" | "openInProgram";

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
  source: "dialog" | "drop" | "library" | "project" | "export";
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
  destination: { kind: "dialog" } | { kind: "project"; projectId: ProjectId } | { kind: "library"; libraryKind: LibraryKind };
  dpi?: number; // nur PNG: pHYs wird gesetzt
}
export const EXPORT_IMAGE_HEADERS = {
  meta: "x-cypher-export-meta", // JSON von ExportImageMeta, encodeURIComponent
} as const;
export const EXPORT_IMAGE_MAX_BYTES = 64 * 1024 * 1024;

/* ========================================================================== */
/* 8. Projekte und Vorlagen                                                   */
/* ========================================================================== */

export type ProjectKind = "shirtMotif" | "socialPost" | "socialStory" | "reel" | "reelCover" | "model3d" | "mockup";

export interface TemplateInfo {
  id: TemplateId;
  kind: ProjectKind;
  title: string; // deutsch
  description: string;
  programId: ProgramId | null; // null = eigenes Modul
  module: "mockup" | "social" | null;
  previewUrl: AssetUrl | null;
  source: "builtin" | "library";
  tags: string[];
  printProfileId: PrintProfileId | null;
  format: { widthPx: number; heightPx: number; dpi: number | null } | null;
  requiresSetup: boolean; // z. B. Blender-App-Template braucht Einrichtung
}

export interface Project {
  id: ProjectId;
  name: string;
  kind: ProjectKind;
  templateId: TemplateId | null;
  programId: ProgramId | null;
  dir: DisplayPath;
  mainFile: string; // relativ zum Projektordner
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastOpenedAt: IsoDateTime | null;
  thumbnailUrl: AssetUrl | null;
  missing: boolean; // Ordner nicht mehr vorhanden
}

export interface ProjectCreateReq {
  templateId: TemplateId;
  name: string; // 1–80 Zeichen; Rust bildet daraus einen sicheren Ordnernamen
}

export interface ProjectRef {
  projectId: ProjectId;
}

export interface ProjectOpenResult {
  /** "launched" = Programm gestartet; "module" = Frontend öffnet eigenes Modul (route). */
  outcome: { kind: "launched"; launch: LaunchResult } | { kind: "module"; module: "mockup" | "social"; projectId: ProjectId };
}

/** Projektdokument der eigenen Module (Mockup/Social). Rust speichert es als JSON, prüft Größe (≤ 1 MB) und schemaVersion. */
export interface ProjectDocument {
  schemaVersion: 1;
  module: "mockup" | "social";
  data: MockupDocument | SocialDocument;
}

export interface ProjectWriteDocumentReq {
  projectId: ProjectId;
  document: ProjectDocument;
}

export interface ProjectAddAssetReq {
  projectId: ProjectId;
  handleId: FileHandleId; // Datei wird in <projekt>/assets/ kopiert
}

export interface ProjectAsset {
  relPath: string; // "assets/motiv-01.png"
  handle: FileHandleInfo;
}

/* ========================================================================== */
/* 9. Bibliothek                                                              */
/* ========================================================================== */

export type LibraryKind = "motif" | "template" | "mockup" | "palette" | "font" | "model" | "video" | "audio" | "other";
export type LibraryEntryStatus = "draft" | "approved" | "archived";
export type SyncTool = "syncthing" | "nextcloud" | "dropbox" | "googleDrive" | "oneDrive" | "iCloud" | "unknown";

export interface LibraryStatus {
  configured: boolean;
  root: DisplayPath | null;
  initialized: boolean; // .cypher/library.json vorhanden
  formatVersion: number | null;
  entryCount: number;
  conflictCount: number; // Konfliktkopien des Sync-Werkzeugs
  lastScanAt: IsoDateTime | null;
  syncTool: SyncTool | null; // erkannt anhand von Markerdateien, nur Anzeige
  watching: boolean;
}

export interface SidecarMeta {
  title: string;
  tags: string[];
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
  meta: SidecarMeta;
  thumbnailUrl: AssetUrl | null;
  conflict: { kind: "syncConflictCopy"; originalRelPath: string | null } | null;
  sidecarMissing: boolean; // noch keine Sidecar-Datei (wird beim ersten Bearbeiten angelegt)
}

export interface LibraryQuery {
  text?: string;
  kinds?: LibraryKind[];
  tags?: string[];
  status?: LibraryEntryStatus[];
  onlyConflicts?: boolean;
  sort?: "modifiedDesc" | "nameAsc" | "kind";
  offset?: number;
  limit?: number; // Standard 60, max. 500
}

export interface LibraryPage {
  entries: LibraryEntry[];
  total: number;
  offset: number;
}

export interface LibraryGetReq {
  entryId: LibraryEntryId;
}

export interface LibraryMetaPatchReq {
  entryId: LibraryEntryId;
  patch: {
    title?: string;
    tags?: string[];
    author?: string;
    status?: LibraryEntryStatus;
    notes?: string;
    colors?: HexColor[];
    printProfileId?: PrintProfileId | null;
    garmentColorIds?: GarmentColorId[];
  };
}

export interface LibraryImportReq {
  handleIds: FileHandleId[];
  kind: LibraryKind;
  subfolder?: string; // relativ, wird validiert
  meta?: { tags?: string[]; author?: string; status?: LibraryEntryStatus };
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
/* 10. Druckprüfer                                                            */
/* ========================================================================== */

export type Severity = "info" | "warning" | "error";

export interface PrintProfile {
  id: PrintProfileId;
  provider: "shirtigo";
  title: string; // "Shirtigo DTG – Brust/Front"
  technique: "dtg" | "dtf" | "embroidery";
  placement: "front" | "back" | "leftChest" | "sleeveLeft" | "sleeveRight" | "neck";
  printAreaMm: { width: number; height: number };
  targetDpi: number; // 300
  warnBelowDpi: number; // z. B. 250
  errorBelowDpi: number; // z. B. 150
  semiTransparency: { warnShare: number; errorShare: number }; // Anteil an sichtbaren Pixeln, 0..1
  minEdgeMarginPx: number; // Motiv sollte nicht am Rand kleben
  maxFileBytes: number | null;
  acceptedFormats: ("png" | "tiff")[];
  colorSpace: "srgb";
  defaultAlign: "topCenter" | "center";
  source: { url: string | null; checkedAt: IsoDateTime | null };
  assumption: boolean; // true = Werte nicht offiziell bestätigt (UI zeigt Hinweis)
}

export type ColorProfileKind = "srgb" | "displayP3" | "adobeRgb" | "gray" | "cmyk" | "other" | "none";

export type PrintRuleId =
  | "format.unsupported"
  | "format.bitDepth16"
  | "format.indexed"
  | "color.cmyk"
  | "color.notSrgb"
  | "color.noProfile"
  | "resolution.tooLow"
  | "resolution.belowTarget"
  | "resolution.metadataMissing"
  | "resolution.upscaleNeeded"
  | "alpha.missing"
  | "alpha.opaqueBackground"
  | "alpha.semiTransparent"
  | "layout.empty"
  | "layout.touchesEdge"
  | "layout.aspectMismatch"
  | "file.tooLarge"
  | "contrast.lowOnGarment";

export interface Finding {
  ruleId: PrintRuleId;
  severity: Severity;
  /** Zahlen/Texte für den deutschen Text im Frontend, z. B. { effectiveDpi: 212, targetDpi: 300 } */
  params: Record<string, number | string | boolean>;
  region: Rect | null; // betroffener Bereich in Bildpixeln (für Overlay)
}

export interface PrintReport {
  engineVersion: string; // printcheck-Regelwerk, z. B. "1.0.0"
  analyzedAt: IsoDateTime;
  file: {
    name: string;
    format: "png" | "tiff" | "jpeg" | "webp" | "other";
    widthPx: number;
    heightPx: number;
    bitDepth: 8 | 16 | 32;
    channels: "gray" | "grayAlpha" | "rgb" | "rgba" | "cmyk" | "indexed";
    fileBytes: number;
  };
  dpi: { x: number; y: number; source: "pHYs" | "tiffTags" | "jfif" | "none" };
  color: { profile: ColorProfileKind; iccDescription: string | null };
  alpha: {
    present: boolean;
    transparentShare: number; // a = 0
    opaqueShare: number; // a = 255
    semiShare: number; // 0 < a < 255, Anteil an allen Pixeln
    semiShareOfVisible: number; // Anteil an Pixeln mit a > 0
  };
  bounds: Rect | null; // Hüllrechteck aller Pixel mit a > Schwelle; null = leer
  marginsPx: { top: number; right: number; bottom: number; left: number } | null;
  profileId: PrintProfileId;
  garmentColorId: GarmentColorId | null;
  placement: {
    printWidthMm: number;
    printHeightMm: number;
    scale: number; // Faktor Bildpixel → Zielpixel bei targetDpi
    effectiveDpi: number; // bei Einpassen in die Druckfläche
    targetPx: Size; // Zielgröße der Exportdatei
  };
  findings: Finding[];
  verdict: "ok" | "warning" | "error";
}

export interface PrintAnalyzeReq {
  handleId: FileHandleId;
  profileId: PrintProfileId;
  garmentColorId?: GarmentColorId;
}

export interface PrintExportOptions {
  trim: boolean; // auf Hüllrechteck zuschneiden
  fit: "contain" | "width" | "height" | "none";
  align: "topCenter" | "center";
  offsetTopMm: number; // nur bei topCenter
  allowUpscale: boolean; // Standard false; true erzeugt Warnung resolution.upscaleNeeded
  destination: { kind: "dialog" } | { kind: "besideSource" } | { kind: "library" } | { kind: "project"; projectId: ProjectId };
}

export interface PrintExportReq {
  handleId: FileHandleId;
  profileId: PrintProfileId;
  options: PrintExportOptions;
}

export type PrintExportEvent =
  | { type: "started"; jobId: JobId }
  | { type: "stage"; stage: "decode" | "analyze" | "resample" | "encode" | "verify" }
  | { type: "finished" };

export interface PrintExportResult {
  output: FileHandleInfo;
  widthPx: number;
  heightPx: number;
  dpi: number;
  report: PrintReport; // erneute Prüfung der erzeugten Datei
}

export interface PrintOverlayReq {
  handleId: FileHandleId;
  overlay: "semiTransparent" | "bounds" | "alphaOnly";
}

/* ========================================================================== */
/* 11. Marke, Mockup, Social                                                  */
/* ========================================================================== */

export interface GarmentColor {
  id: GarmentColorId;
  name: string; // "Schwarz"
  hex: HexColor; // "#141210"
  heather: boolean; // meliert → Strukturebene
  textOnGarment: HexColor; // empfohlene Kontrastfarbe für Hinweise
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
  garmentColors: GarmentColor[];
  palettes: Palette[];
  fonts: BrandFont[];
  logos: { id: string; variant: "light" | "dark"; url: AssetUrl }[];
}

/** Viereck der Druckfläche im Vorlagenbild: oben links, oben rechts, unten rechts, unten links. */
export type Quad = [Point, Point, Point, Point];

export interface MockupTemplate {
  id: MockupTemplateId;
  title: string;
  garment: "tshirt" | "hoodie";
  view: "front" | "back";
  canvas: Size; // z. B. 2400 × 3000
  layers: {
    mask: AssetUrl; // Alpha = Textilfläche
    shade: AssetUrl; // Graustufen, multiply (Falten/Schatten)
    light: AssetUrl; // Graustufen, screen (Glanzlichter)
    displace: AssetUrl | null; // R = dx, G = dy (128 = 0)
    heather: AssetUrl | null; // Melange-Struktur, nur für heather-Farben
    background: AssetUrl | null;
  };
  printArea: { quad: Quad; widthMm: number; heightMm: number };
  displaceStrengthPx: number;
  colorIds: GarmentColorId[];
}

export interface MockupDocument {
  templateId: MockupTemplateId;
  colorId: GarmentColorId;
  design: { relPath: string } | null; // Projekt-Asset
  placement: { scale: number; offsetMm: Point }; // relativ zur Druckfläche
  background: { kind: "transparent" } | { kind: "color"; hex: HexColor } | { kind: "template" };
  exportSizePx: Size;
}

export type SocialFormat = "post" | "story" | "reelCover";

export const SOCIAL_FORMAT_SIZES: Record<SocialFormat, Size> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  reelCover: { width: 1080, height: 1920 },
};

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
  /** Bereiche, die Instagram-Oberfläche verdeckt (nur Hilfslinien, nicht exportiert). */
  safeZones: Rect[];
  /** Reel-Cover: Ausschnitt im Profilraster (3:4), nur Hilfslinie. */
  gridCrop: Rect | null;
  previewUrl: AssetUrl | null;
}

export interface SocialDocument {
  templateId: SocialTemplateId;
  format: SocialFormat;
  texts: Record<string, string>; // slot → Text
  images: Record<string, { relPath: string; focal: Point } | null>; // slot → Projekt-Asset
  colorOverrides: Record<string, HexColor>; // layerId → Farbe
  exportFormat: "png" | "jpeg";
}

/* ========================================================================== */
/* 12. App-Update, Jobs, Fenster schließen                                    */
/* ========================================================================== */

export interface UpdateCheck {
  available: boolean;
  currentVersion: SemVer;
  version: SemVer | null;
  date: IsoDateTime | null;
  notes: string | null; // Markdown aus dem Release, im Frontend als reiner Text dargestellt
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

export interface JobInfo {
  id: JobId;
  kind: JobKind;
  subject: string; // z. B. Programm-ID oder Dateiname
  startedAt: IsoDateTime;
  cancellable: boolean;
}

export interface JobCancelReq {
  jobId: JobId;
}

export interface AppCloseReq {
  /** true = laufende Jobs abbrechen (Aufräumen läuft), dann beenden. */
  force: boolean;
}

/* ========================================================================== */
/* 13. Hintergrundentfernung (Phase 5, Vertrag reserviert)                    */
/* ========================================================================== */

export interface BgRemoveStatus {
  available: boolean; // Feature im Build aktiv
  model: { id: string; name: string; license: LicenseInfo; size: number; installed: boolean } | null;
}

export interface BgRemoveRunReq {
  handleId: FileHandleId;
  refineEdges?: boolean;
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
  // --- app / settings / diagnostics
  app_info: { args: NoArgs; result: AppInfo };
  app_open_external: { args: Req<OpenExternalReq>; result: null };
  app_reveal: { args: Req<RevealReq>; result: null };
  app_close: { args: Req<AppCloseReq>; result: null };
  settings_get: { args: NoArgs; result: Settings };
  settings_update: { args: Req<SettingsPatch>; result: Settings };
  settings_choose_dir: { args: Req<SettingsChooseDirReq>; result: Settings | null };
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

  // --- files
  file_pick: { args: Req<FilePickReq>; result: FileHandleInfo[] };

  // --- projects / templates
  templates_list: { args: NoArgs; result: TemplateInfo[] };
  projects_list: { args: NoArgs; result: Project[] };
  project_create: { args: Req<ProjectCreateReq>; result: Project };
  project_open: { args: Req<ProjectRef>; result: ProjectOpenResult };
  project_forget: { args: Req<ProjectRef>; result: null };
  project_read_document: { args: Req<ProjectRef>; result: ProjectDocument | null };
  project_write_document: { args: Req<ProjectWriteDocumentReq>; result: Project };
  project_add_asset: { args: Req<ProjectAddAssetReq>; result: ProjectAsset };
  project_assets: { args: Req<ProjectRef>; result: ProjectAsset[] };

  // --- library
  library_status: { args: NoArgs; result: LibraryStatus };
  library_choose_root: { args: NoArgs; result: LibraryStatus | null };
  library_init: { args: NoArgs; result: LibraryStatus };
  library_scan: { args: Ch<ScanEvent>; result: LibraryStatus };
  library_query: { args: Req<LibraryQuery>; result: LibraryPage };
  library_get: { args: Req<LibraryGetReq>; result: LibraryEntry };
  library_update_meta: { args: Req<LibraryMetaPatchReq>; result: LibraryEntry };
  library_import: { args: Req<LibraryImportReq>; result: LibraryEntry[] };
  library_entry_handle: { args: Req<LibraryGetReq>; result: FileHandleInfo };
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
  job_cancel: { args: Req<JobCancelReq>; result: boolean };

  // --- bgremove (Phase 5; Commands existieren erst mit Cargo-Feature "bgremove")
  bgremove_status: { args: NoArgs; result: BgRemoveStatus };
  bgremove_model_preview: { args: NoArgs; result: InstallPlan };
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
  "library:changed": { reason: "watcher" | "import" | "scan" | "meta" | "packImport"; changedCount: number };
  "files:dropped": { handles: FileHandleInfo[]; position: Point };
  "update:available": UpdateCheck;
  "app:closeRequested": { activeJobs: JobInfo[] };
  "jobs:changed": { active: JobInfo[] };
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
  "file_pick",
  "templates_list",
  "projects_list",
  "project_create",
  "project_open",
  "project_forget",
  "project_read_document",
  "project_write_document",
  "project_add_asset",
  "project_assets",
  "library_status",
  "library_choose_root",
  "library_init",
  "library_scan",
  "library_query",
  "library_get",
  "library_update_meta",
  "library_import",
  "library_entry_handle",
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
  "files:dropped",
  "update:available",
  "app:closeRequested",
  "jobs:changed",
] as const satisfies readonly EventName[];

/* Compile-Zeit-Prüfung: COMMAND_NAMES und EVENT_NAMES sind vollständig. */
type MissingCommands = Exclude<CommandName, (typeof COMMAND_NAMES)[number]>;
type MissingEvents = Exclude<EventName, (typeof EVENT_NAMES)[number]>;
export const __contractComplete: [MissingCommands, MissingEvents] extends [never, never] ? true : never = true;
