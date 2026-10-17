/**
 * Mock-Handler für ALLE Commands des Vertrags (ARCHITEKTUR 8.2). Der Typ erzwingt Vollständigkeit zur Compile-Zeit;
 * ein Vitest-Test prüft zusätzlich gegen `COMMAND_NAMES`.
 */
import { emit } from "@tauri-apps/api/event";
import type {
  AppError,
  CommandArgs,
  CommandName,
  CommandResult,
  FileHandleInfo,
  InstallPlan,
  LibraryEntry,
  Project,
  ProjectDocument,
  ProjectFile,
  SetupRecord,
  UndoReport,
} from "@contract";
import { now, nowIso } from "../../lib/clock";
import { motifUrl, overlayUrl, teeLayers, TEE_CANVAS, TEE_QUAD } from "./art";
import { packMockupTemplates } from "./packs";
import {
  CATALOG,
  GARMENTS,
  GIB,
  LIBRARY_ROOT,
  MIB,
  PRINT_PROFILES,
  PROGRAMS_DIR,
  brandFixture,
  fakeSha,
  networkFixture,
} from "./fixtures";
import { checkConsent, makePlan, runInstall } from "./install";
import { generateLibrary, queryLibrary, toEntry } from "./library";
import { SAMPLES, analyze, type SampleImage } from "./printcheck";
import { socialTemplates } from "./social";
import {
  PACKS,
  buildSetupPlan,
  catalogProgram,
  db,
  finishJob,
  iso,
  newId,
  programOverview,
  programsView,
  progressJob,
  setupSummary,
  sleepScaled,
  startJob,
} from "./state";

type Handlers = { [K in CommandName]: (args: CommandArgs<K>) => Promise<CommandResult<K>> | CommandResult<K> };

const err = (e: AppError): never => {
  // Ablehnung mit AppError-Objekt, wie Tauri es liefert (JSON-Wert)
  throw e;
};

function offlineGuard(): void {
  if (db.flags.has("offline"))
    err({
      kind: "network",
      host: "studio.cypherxcypher.de",
      message: "Keine Verbindung zum Cypher-Manifest",
      retryable: true,
    });
}

/* ---------- Handles ---------- */

async function handleForSample(name: string, source: FileHandleInfo["source"] = "dialog"): Promise<FileHandleInfo> {
  const sample = SAMPLES[name];
  if (!sample) throw { kind: "notFound", entity: "fileHandle", id: name } satisfies AppError;
  const existing = [...db.handles.values()].find((h) => h.sample === name && h.source === source);
  if (existing) return existing;
  const url = sample.unreadable ? null : await motifUrl(sample.motif);
  const handle: FileHandleInfo & { sample?: string } = {
    id: `fh-${newId().slice(0, 8)}`,
    name,
    displayPath: `${LIBRARY_ROOT}\\Projekte\\Herbst-Drop 26\\Motive\\${name}`,
    size: sample.fileBytes,
    mime: sample.mime,
    url,
    source,
    sample: name,
  };
  db.handles.set(handle.id, handle);
  return handle;
}

export function registerBlobHandle(file: File, url: string, widthPx: number, heightPx: number): FileHandleInfo {
  const base = SAMPLES["rauschen_logo.png"] as SampleImage;
  const name = file.name;
  const sampleName = `drop:${name}`;
  SAMPLES[sampleName] = {
    ...base,
    name,
    widthPx,
    heightPx,
    fileBytes: file.size,
    mime: file.type || "image/png",
    format: file.type === "image/jpeg" ? "jpeg" : "png",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    minStrokePx: null,
  };
  const handle: FileHandleInfo & { sample?: string } = {
    id: `fh-${newId().slice(0, 8)}`,
    name,
    displayPath: `C:\\Users\\Lena\\Downloads\\${name}`,
    size: file.size,
    mime: file.type || "image/png",
    url,
    source: "drop",
    sample: sampleName,
  };
  db.handles.set(handle.id, handle);
  return handle;
}

function sampleOfHandle(id: string): SampleImage {
  const h = db.handles.get(id);
  const s = h?.sample ? SAMPLES[h.sample] : undefined;
  if (!h || !s) throw { kind: "notFound", entity: "fileHandle", id } satisfies AppError;
  return s;
}

function requestedSample(): string {
  const forced = (window as unknown as { __CYPHER_PICK__?: string }).__CYPHER_PICK__;
  if (forced && SAMPLES[forced]) return forced;
  return "signal_v3.png";
}

/* ---------- Projekte ---------- */

const documents = new Map<string, ProjectDocument>();

function projectOf(id: string): Project {
  const p = db.projects.find((x) => x.id === id);
  if (!p) throw { kind: "notFound", entity: "project", id } satisfies AppError;
  return p;
}

function openResult(programId: string | null) {
  if (programId && !(db.installations[programId] ?? []).length) {
    return { outcome: { kind: "programMissing" as const, programId } };
  }
  const targetProgram = programId ?? "krita";
  const inst = (db.installations[targetProgram] ?? [])[0];
  return {
    outcome: {
      kind: "launched" as const,
      launch: {
        programId: targetProgram,
        installationId: inst?.id ?? `cypher:${targetProgram}`,
        pid: 4812,
        startedAt: nowIso(),
      },
    },
  };
}

/* ---------- Befehle ---------- */

export const handlers: Handlers = {
  /* app / settings */
  app_info: () => ({
    appVersion: "0.4.0",
    contractVersion: "0.2.0",
    os: "windows",
    arch: "x86_64",
    osVersion: "Windows 11 Pro 24H2",
    dataDir: "C:\\Users\\Lena\\AppData\\Local\\de.cypherxcypher.studio\\data",
    logsDir: "C:\\Users\\Lena\\AppData\\Local\\de.cypherxcypher.studio\\logs",
    buildChannel: "dev",
  }),
  app_open_external: () => null,
  app_reveal: () => null,
  app_close: () => null,
  settings_get: () => structuredClone(db.settings),
  settings_update: (args) => {
    const p = args.req;
    const s = db.settings;
    if (p.updates?.frequency) s.updates.frequency = p.updates.frequency;
    if (p.catalog?.autoRefresh !== undefined) s.catalog.autoRefresh = p.catalog.autoRefresh;
    if (p.downloads) s.downloads = { ...s.downloads, ...p.downloads };
    if (p.linux) s.linux = { ...s.linux, ...p.linux };
    if (p.profile?.displayName !== undefined) s.profile.displayName = p.profile.displayName;
    if (p.ui) s.ui = { ...s.ui, ...p.ui };
    if (p.onboarding) s.onboarding = { ...s.onboarding, ...p.onboarding, updatedAt: nowIso() };
    return structuredClone(s);
  },
  settings_choose_dir: (args) => {
    if (args.req.which === "programsDir") db.settings.programsDir = "D:\\Programme\\Cypher";
    else db.settings.projectsDir = "D:\\Sync\\Cypher\\Projekte";
    return structuredClone(db.settings);
  },
  network_info: () => networkFixture(),
  diagnostics_export: async () =>
    handleForSample("signal_v3.png", "export").then((h) => ({
      ...h,
      name: "cypher-studio-diagnose.zip",
      mime: "application/zip",
      url: null,
    })),

  /* catalog */
  catalog_status: () => db.catalog,
  catalog_refresh: async () => {
    await sleepScaled(700);
    offlineGuard();
    db.catalog = { ...db.catalog, lastCheckAt: nowIso(), lastError: null };
    return { status: db.catalog, changed: false };
  },

  /* programs */
  programs_list: () => programsView(),
  programs_rescan: async () => {
    await sleepScaled(600);
    void emit("programs:changed", { reason: "rescanned" });
    return programsView();
  },
  program_set_preferred: (args) => {
    db.preferred[args.req.programId] = args.req.installationId;
    const p = catalogProgram(args.req.programId);
    if (!p) return err({ kind: "notFound", entity: "program", id: args.req.programId });
    void emit("programs:changed", { reason: "preferredChanged" });
    return programOverview(p);
  },
  program_add_manual: () => null,
  install_preview: async (args) => {
    await sleepScaled(250);
    offlineGuard();
    const v = args.req.version;
    return makePlan(args.req.programId, v);
  },
  install_start: (args) => runInstall(args.req, (e) => args.onEvent.onmessage(e)),
  installation_remove: (args) => {
    for (const list of Object.values(db.installations)) {
      const i = list.findIndex((x) => x.id === args.req.installationId);
      if (i >= 0) {
        list.splice(i, 1);
        void emit("programs:changed", { reason: "removed" });
        return null;
      }
    }
    return err({ kind: "notFound", entity: "installation", id: args.req.installationId });
  },
  program_launch: (args) => {
    const list = db.installations[args.req.programId] ?? [];
    const inst = list.find((i) => i.id === args.req.installationId) ?? list[0];
    if (!inst) return err({ kind: "launchFailed", programId: args.req.programId, reason: "Nicht installiert" });
    return { programId: args.req.programId, installationId: inst.id, pid: 4210, startedAt: nowIso() };
  },

  /* setup */
  setup_packs_list: () =>
    Object.values(PACKS).map((def) =>
      setupSummary(def.packId, def.programId ? (catalogProgram(def.programId) ?? null) : null),
    ),
  setup_status: (args) => {
    const def = PACKS[args.req.packId];
    if (!def) return err({ kind: "notFound", entity: "setupScope", id: args.req.packId });
    return setupSummary(def.packId, def.programId ? (catalogProgram(def.programId) ?? null) : null);
  },
  setup_preview: async (args) => {
    await sleepScaled(250);
    if (!PACKS[args.req.packId]) return err({ kind: "setupUnsupported", packId: args.req.packId, reason: "noPack" });
    return buildSetupPlan(args.req.packId, args.req.scopeId);
  },
  setup_apply: async (args) => {
    const stored = db.setupPlans.get(args.req.planId);
    if (!stored) return err({ kind: "planExpired", planId: args.req.planId });
    const { plan } = stored;
    const state = db.setup[plan.packId];
    if (!state) return err({ kind: "notFound", entity: "setupScope", id: plan.packId });
    const job = startJob(
      "setupApply",
      PACKS[plan.packId]?.programId
        ? (catalogProgram(PACKS[plan.packId]?.programId ?? "")?.name ?? plan.packId)
        : "Schriften",
      PACKS[plan.packId]?.programId ?? null,
      false,
    );
    const chosen = plan.components.filter((c) => args.req.components.includes(c.id));
    const ops = chosen.flatMap((c) => c.operations.map((o) => ({ c, o })));
    args.onEvent.onmessage({ type: "started", jobId: job.info.id, total: ops.length });
    state.before = { ...state.components };
    let files = 0;
    let backups = 0;
    const failures: SetupRecord["failures"] = [];
    let idx = 0;
    for (const { c, o } of ops) {
      await sleepScaled(380);
      idx += 1;
      progressJob(job, idx / Math.max(1, ops.length), "apply");
      args.onEvent.onmessage({ type: "step", index: idx, total: ops.length, componentId: c.id, operation: o });
    }
    for (const c of chosen) {
      const locked = db.flags.has("setupLocked") && c.id === "templates";
      if (locked) {
        failures.push({
          target: c.operations[0]?.target ?? "",
          error: {
            kind: "io",
            op: "write",
            path: c.operations[0]?.target ?? null,
            message: "Die Datei ist von Krita gesperrt.",
          },
        });
        state.components[c.id] = "partial";
        continue;
      }
      if (c.status === "userModified") {
        const resolution = args.req.resolutions[c.operations[0]?.conflictId ?? ""] ?? "skip";
        if (resolution === "skip") continue;
        if (resolution === "overwrite") backups += 1;
      }
      files += c.operations.filter((o) => o.kind !== "skip").length;
      state.components[c.id] = "current";
    }
    const record: SetupRecord = {
      setupId: newId(),
      packId: plan.packId,
      programId: plan.programId,
      scopeId: plan.scopeId,
      packVersion: plan.packVersion,
      components: chosen.map((c) => c.id),
      appliedAt: nowIso(),
      status: failures.length ? "partial" : "applied",
      filesWritten: files,
      backupsTaken: backups + (plan.previous ? 1 : 0),
      undoAvailable: true,
      failures,
    };
    for (const r of state.history) r.undoAvailable = false;
    state.history.unshift(record);
    db.setupPlans.delete(plan.planId);
    finishJob(job, "succeeded", null, { kind: "setup", setupId: record.setupId });
    void emit("programs:changed", { reason: "setupChanged" });
    args.onEvent.onmessage({ type: "finished", record });
    return record;
  },
  setup_undo: async (args) => {
    await sleepScaled(500);
    for (const state of Object.values(db.setup)) {
      const rec = state.history.find((r) => r.setupId === args.req.setupId);
      if (rec) {
        rec.status = "undone";
        rec.undoAvailable = false;
        if (state.before) state.components = { ...state.before };
        state.before = null;
        void emit("programs:changed", { reason: "setupChanged" });
        const report: UndoReport = {
          setupId: rec.setupId,
          restored: rec.backupsTaken,
          removed: Math.max(0, rec.filesWritten - rec.backupsTaken),
          keptModified: [],
          fontsRemoved: rec.components.includes("fonts") ? 3 : 0,
        };
        return report;
      }
    }
    return err({ kind: "notFound", entity: "setupRecord", id: args.req.setupId });
  },
  setup_history: (args) => db.setup[args.req.packId]?.history ?? [],

  /* files */
  file_pick: async (args) => {
    await sleepScaled(150);
    const purpose = args.req.purpose;
    if (purpose === "libraryImport") {
      return Promise.all([handleForSample("rauschen_logo.png"), handleForSample("signal_v3.png")]);
    }
    const forced = requestedSample();
    const name = forced;
    return [await handleForSample(name)];
  },
  samples_list: async () => {
    const handle = await handleForSample("signal_v3.png", "sample");
    return [
      {
        id: "probe-motiv",
        title: "Probe-Motiv",
        description: "Absichtlich mit Halbtransparenz, damit du den Druckprüfer kennenlernst.",
        handle,
      },
    ];
  },

  /* projects */
  templates_list: () => db.templates,
  projects_list: () => {
    if (db.flags.has("folderLost"))
      return err({ kind: "io", op: "read", path: LIBRARY_ROOT, message: "Der Ordner ist nicht erreichbar." });
    if (db.flags.has("offline") || db.flags.has("default") || db.flags.has("fresh")) {
      /* normal */
    }
    return db.projects;
  },
  project_create: (args) => {
    const name = args.req.name.trim() || "Neues Projekt";
    const clash = db.projects.filter((p) => p.name === name || p.name.startsWith(`${name} (`)).length;
    const finalName = clash ? `${name} (${clash + 1})` : name;
    const stamp = nowIso();
    const project: Project = {
      id: `proj-${finalName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: finalName,
      collection: args.req.collection ?? null,
      dir: `${LIBRARY_ROOT}\\Projekte\\${finalName}`,
      inLibrary: true,
      fileCount: 0,
      lastFile: null,
      createdAt: stamp,
      updatedAt: stamp,
      missing: false,
    };
    db.projects.unshift(project);
    void emit("projects:changed", { projectId: project.id });
    return project;
  },
  project_new_file: (args) => {
    const project = projectOf(args.req.projectId);
    const tpl = db.templates.find((t) => t.id === args.req.templateId);
    if (!tpl) return err({ kind: "notFound", entity: "template", id: args.req.templateId });
    const rel = `${tpl.folder}/${args.req.fileName}${tpl.fileExtension}`;
    project.fileCount += 1;
    project.updatedAt = nowIso();
    project.lastFile = { relPath: rel, modifiedAt: nowIso(), programId: tpl.programId, module: null };
    void emit("projects:changed", { projectId: project.id });
    const handle: FileHandleInfo = {
      id: `fh-${newId().slice(0, 8)}`,
      name: `${args.req.fileName}${tpl.fileExtension}`,
      displayPath: `${project.dir}\\${rel.replace("/", "\\")}`,
      size: 48_000,
      mime: "application/octet-stream",
      url: null,
      source: "project",
    };
    db.handles.set(handle.id, handle);
    const file: ProjectFile = { projectId: project.id, ref: project.lastFile, handle };
    return file;
  },
  project_open_file: (args) => {
    projectOf(args.req.projectId); // wirft notFound bei unbekanntem Projekt
    const ext = args.req.relPath.split(".").pop() ?? "";
    const prog = ext === "svg" ? "inkscape" : ext === "kdenlive" ? "kdenlive" : ext === "blend" ? "blender" : "krita";
    return openResult(prog);
  },
  project_open_last: (args) => {
    const project = projectOf(args.req.projectId);
    return openResult(project.lastFile?.programId ?? "krita");
  },
  project_file_handle: (args) => {
    const project = projectOf(args.req.projectId);
    return {
      id: `fh-${newId().slice(0, 8)}`,
      name: args.req.relPath.split("/").pop() ?? "",
      displayPath: `${project.dir}\\${args.req.relPath}`,
      size: 1_200_000,
      mime: "application/octet-stream",
      url: null,
      source: "project",
    };
  },
  project_set_collection: (args) => {
    const project = projectOf(args.req.projectId);
    project.collection = args.req.collection;
    void emit("projects:changed", { projectId: project.id });
    return project;
  },
  project_forget: (args) => {
    db.projects = db.projects.filter((p) => p.id !== args.req.projectId);
    void emit("projects:changed", { projectId: args.req.projectId });
    return null;
  },
  project_read_document: (args) => documents.get(`${args.req.projectId}/${args.req.relPath}`) ?? null,
  project_write_document: (args) => {
    documents.set(`${args.req.projectId}/${args.req.relPath}`, args.req.document);
    return { relPath: args.req.relPath, modifiedAt: nowIso(), programId: null, module: args.req.document.module };
  },
  project_add_asset: (args) => {
    const h = db.handles.get(args.req.handleId);
    if (!h) return err({ kind: "notFound", entity: "fileHandle", id: args.req.handleId });
    return { relPath: `${args.req.folder ?? "Motive"}/${h.name}`, handle: h };
  },

  /* library */
  library_status: () => db.libraryStatus,
  library_choose_root: async () => {
    await sleepScaled(300);
    return {
      candidateId: "cand-1",
      path: LIBRARY_ROOT,
      fileCount: 3104,
      totalBytes: 41 * GIB,
      projectCount: 12,
      initialized: true,
      syncTool: "syncthing" as const,
      problems: [],
    };
  },
  library_use_root: async () => {
    await sleepScaled(400);
    db.settings.libraryRoot = LIBRARY_ROOT;
    if (db.projects.length === 0) {
      const { projectsSeed } = await import("./library");
      db.projects = projectsSeed(now());
    }
    db.library = generateLibrary(3104, now(), db.projects);
    db.libraryStatus = {
      configured: true,
      root: LIBRARY_ROOT,
      initialized: true,
      formatVersion: 1,
      entryCount: db.library.entries.length,
      totalBytes: 41 * GIB,
      projectCount: db.projects.length,
      conflictCount: db.library.entries.filter((e) => e.conflict).length,
      lastScanAt: nowIso(),
      syncTool: "syncthing",
      watching: true,
      collections: db.libraryStatus.collections,
    };
    void emit("library:changed", { reason: "rootChanged", changedCount: db.library.entries.length });
    void emit("projects:changed", { projectId: null });
    return db.libraryStatus;
  },
  library_scan: async (args) => {
    const job = startJob("libraryScan", "Gemeinsamer Ordner", null);
    args.onEvent.onmessage({ type: "started", jobId: job.info.id });
    const total = db.libraryStatus.entryCount || 3104;
    for (let i = 1; i <= 8; i++) {
      if (job.cancelled) break;
      await sleepScaled(160);
      const scanned = Math.round((total * i) / 8);
      args.onEvent.onmessage({ type: "progress", scanned, found: scanned });
      progressJob(job, i / 8, "scan");
    }
    db.libraryStatus = { ...db.libraryStatus, lastScanAt: nowIso() };
    args.onEvent.onmessage({ type: "finished", status: db.libraryStatus });
    finishJob(job, "succeeded", null, { kind: "none" });
    return db.libraryStatus;
  },
  library_query: (args) => {
    if (!db.library) return err({ kind: "libraryNotConfigured" });
    return queryLibrary(db.library, args.req);
  },
  library_get: (args) => {
    const e = db.library?.entries.find((x) => x.id === args.req.entryId);
    if (!e) return err({ kind: "notFound", entity: "libraryEntry", id: args.req.entryId });
    return toEntry(e);
  },
  library_update_meta: (args) => {
    const e = db.library?.entries.find((x) => x.id === args.req.entryId);
    if (!e) return err({ kind: "notFound", entity: "libraryEntry", id: args.req.entryId });
    const p = args.req.patch;
    if (p.title !== undefined) e.meta.title = p.title;
    if (p.tags !== undefined) e.meta.tags = p.tags;
    if (p.collection !== undefined) e.meta.collection = p.collection;
    if (p.author !== undefined) e.meta.author = p.author;
    if (p.status !== undefined) e.meta.status = p.status;
    if (p.notes !== undefined) e.meta.notes = p.notes;
    e.meta.updatedAt = nowIso();
    e.sidecarMissing = false;
    void emit("library:changed", { reason: "meta", changedCount: 1 });
    return toEntry(e);
  },
  library_bulk_meta: (args) => {
    let n = 0;
    for (const e of db.library?.entries ?? []) {
      if (!args.req.entryIds.includes(e.id)) continue;
      if (args.req.addTags) e.meta.tags = [...new Set([...e.meta.tags, ...args.req.addTags])];
      if (args.req.removeTags) e.meta.tags = e.meta.tags.filter((t) => !args.req.removeTags?.includes(t));
      if (args.req.collection !== undefined) e.meta.collection = args.req.collection;
      n += 1;
    }
    void emit("library:changed", { reason: "meta", changedCount: n });
    return n;
  },
  library_import: (args) => {
    const out: LibraryEntry[] = [];
    for (const id of args.req.handleIds) {
      const h = db.handles.get(id);
      if (!h || !db.library) continue;
      const base = db.library.entries[0];
      if (!base) continue;
      const entry = {
        ...base,
        id: newId(),
        fileName: h.name,
        relPath: `${args.req.subfolder ?? "Import"}/${h.name}`,
        modifiedAt: nowIso(),
        hasThumb: true,
      };
      db.library.entries.unshift(entry);
      out.push(toEntry(entry));
    }
    void emit("library:changed", { reason: "import", changedCount: out.length });
    return out;
  },
  library_entry_handle: (args) => {
    const e = db.library?.entries.find((x) => x.id === args.req.entryId);
    if (!e) return err({ kind: "notFound", entity: "libraryEntry", id: args.req.entryId });
    return {
      id: `fh-${newId().slice(0, 8)}`,
      name: e.fileName,
      displayPath: `${LIBRARY_ROOT}\\${e.relPath.replaceAll("/", "\\")}`,
      size: e.size,
      mime: e.mime,
      url: null,
      source: "library",
    };
  },
  library_set_collections: (args) => {
    db.libraryStatus = { ...db.libraryStatus, collections: args.req.collections };
    return db.libraryStatus;
  },
  library_thumbnails_clear: () => null,
  library_pack_export: async (args) => {
    const job = startJob("packExport", args.req.title, null);
    args.onEvent.onmessage({ type: "started", jobId: job.info.id, total: args.req.entryIds.length });
    for (let i = 1; i <= args.req.entryIds.length; i++) {
      await sleepScaled(80);
      args.onEvent.onmessage({ type: "progress", done: i, total: args.req.entryIds.length });
    }
    args.onEvent.onmessage({ type: "finished" });
    finishJob(job, "succeeded", null, { kind: "none" });
    return {
      id: `fh-${newId().slice(0, 8)}`,
      name: `${args.req.title}.cypherpack`,
      displayPath: `C:\\Users\\Lena\\Desktop\\${args.req.title}.cypherpack`,
      size: 12 * MIB,
      mime: "application/zip",
      url: null,
      source: "export",
    };
  },
  library_pack_inspect: (args) => ({
    handleId: args.req.handleId,
    formatVersion: 1,
    title: "Herbst-Drop Motive",
    createdBy: "Jonas",
    createdAt: iso(-60 * 24),
    appVersion: "0.4.0",
    entries: [],
    totalBytes: 12 * MIB,
  }),
  library_pack_import: (args) => {
    args.onEvent.onmessage({ type: "finished" });
    return { imported: 0, skipped: 0, renamed: 0, overwritten: 0 };
  },

  /* printcheck */
  print_profiles_list: () => PRINT_PROFILES,
  printcheck_analyze: async (args) => {
    await sleepScaled(320);
    const sample = sampleOfHandle(args.req.handleId);
    if (sample.unreadable) return err(sample.unreadable);
    const profile = PRINT_PROFILES.find((p) => p.id === args.req.profileId);
    if (!profile) return err({ kind: "notFound", entity: "printProfile", id: args.req.profileId });
    return analyze(
      {
        sample,
        profile,
        garmentColorId: args.req.garmentColorId ?? "schwarz",
        technique: args.req.technique ?? profile.techniques[0] ?? "dtg",
        plannedWidthMm: args.req.plannedWidthMm ?? profile.defaultWidthMm,
      },
      nowIso(),
    );
  },
  printcheck_export: async (args) => {
    const sample = sampleOfHandle(args.req.handleId);
    const profile = PRINT_PROFILES.find((p) => p.id === args.req.profileId);
    if (!profile) return err({ kind: "notFound", entity: "printProfile", id: args.req.profileId });
    const job = startJob("printExport", sample.name, null);
    args.onEvent.onmessage({ type: "started", jobId: job.info.id });
    const stages = ["decode", "analyze", "fix", "resample", "colorConvert", "encode", "verify"] as const;
    for (const [i, stage] of stages.entries()) {
      if (job.cancelled) {
        finishJob(job, "cancelled", null, { kind: "none" });
        return err({ kind: "cancelled" });
      }
      await sleepScaled(320);
      args.onEvent.onmessage({ type: "stage", stage });
      progressJob(job, (i + 1) / stages.length, stage);
    }
    const o = args.req.options;
    const widthPx = Math.round((o.plannedWidthMm / 25.4) * 300);
    const trimmed = {
      w: sample.widthPx - sample.margins.left - sample.margins.right,
      h: sample.heightPx - sample.margins.top - sample.margins.bottom,
    };
    const heightPx = Math.round(widthPx * (trimmed.h / trimmed.w));
    const base = sample.name.replace(/\.[^.]+$/, "");
    const placement = profile.placement === "front" ? "front" : "back";
    const fileName = `${base}_${profile.product.id}-${placement}_${Math.round(o.plannedWidthMm)}mm_300dpi.png`;
    const dir =
      o.destination.kind === "project"
        ? `${LIBRARY_ROOT}\\Projekte\\Herbst-Drop 26\\Export\\Druck`
        : o.destination.kind === "library"
          ? `${LIBRARY_ROOT}\\Export\\Druck`
          : "C:\\Users\\Lena\\Desktop";
    const output: FileHandleInfo = {
      id: `fh-${newId().slice(0, 8)}`,
      name: fileName,
      displayPath: `${dir}\\${fileName}`,
      size: Math.round(sample.fileBytes * 0.95),
      mime: "image/png",
      url: sample.unreadable ? null : await motifUrl(sample.motif),
      source: "export",
    };
    db.handles.set(output.id, output);
    const report = analyze(
      {
        sample,
        profile,
        garmentColorId: args.req.garmentColorId ?? "schwarz",
        technique: args.req.technique ?? profile.techniques[0] ?? "dtg",
        plannedWidthMm: o.plannedWidthMm,
        after: {
          widthPx: Math.max(widthPx, 1),
          heightPx: Math.max(heightPx, 1),
          dpiFromMeta: true,
          profile: o.colorProfile,
          semi: o.fixes.semiTransparency !== "keep",
          ghost: o.fixes.cleanGhostPixels,
        },
      },
      nowIso(),
    );
    args.onEvent.onmessage({ type: "finished" });
    finishJob(job, "succeeded", null, { kind: "file", handle: output });
    void emit("library:changed", { reason: "import", changedCount: 1 });
    const placementJson: FileHandleInfo | null = o.writePlacementJson
      ? {
          ...output,
          id: `fh-${newId().slice(0, 8)}`,
          name: `${fileName.replace(/\.png$/, "")}.shirtigo.json`,
          displayPath: `${dir}\\${fileName.replace(/\.png$/, "")}.shirtigo.json`,
          size: 412,
          mime: "application/json",
          url: null,
        }
      : null;
    return { output, placementJson, widthPx, heightPx, dpi: 300, colorProfile: o.colorProfile, report };
  },
  printcheck_overlay: async (args) => {
    const sample = sampleOfHandle(args.req.handleId);
    void sample;
    return {
      id: `fh-${newId().slice(0, 8)}`,
      name: "overlay.png",
      displayPath: "",
      size: 20_000,
      mime: "image/png",
      url: await overlayUrl(),
      source: "export",
    };
  },

  /* brand / mockup / social */
  brand_get: () => brandFixture(),
  mockup_templates_list: async () => {
    // Die echten Vorlagen aus packs/mockups; nur ohne Paket im Repository die gezeichnete Platzhalter-Vorlage
    const fromPack = packMockupTemplates();
    if (fromPack.length > 0) return fromPack;
    const layers = await teeLayers();
    const q = TEE_QUAD;
    return [
      {
        id: "platzhalter-shirt-vorne",
        title: "Platzhalter-Shirt · vorne",
        product: "tee" as const,
        view: "front" as const,
        canvas: { width: TEE_CANVAS.width, height: TEE_CANVAS.height },
        printProfileId: "shirtigo-tee-front",
        printArea: { quad: [q.tl, q.tr, q.br, q.bl] as [typeof q.tl, typeof q.tr, typeof q.br, typeof q.bl] },
        displaceStrengthPx: 6,
        variants: [
          {
            exposure: "light" as const,
            layers: {
              mask: layers.mask,
              shade: layers.shade,
              light: layers.light,
              displace: layers.displace,
              texture: null,
              heather: layers.heather,
              background: layers.background,
            },
            colorIds: ["weiss", "creme", "sand", "grau-meliert"],
          },
          {
            exposure: "dark" as const,
            layers: {
              mask: layers.mask,
              shade: layers.shade,
              light: layers.light,
              displace: layers.displace,
              texture: null,
              heather: null,
              background: layers.background,
            },
            colorIds: ["schwarz", "navy"],
          },
        ],
      },
    ];
  },
  social_templates_list: () => socialTemplates(),

  /* updater */
  app_update_check: async () => {
    await sleepScaled(500);
    offlineGuard();
    db.update = { ...db.update, checkedAt: nowIso() };
    return db.update;
  },
  app_update_install: async (args) => {
    const total = 9.8 * MIB;
    args.onEvent.onmessage({ type: "started", jobId: newId(), contentLength: total });
    for (let i = 1; i <= 10; i++) {
      await sleepScaled(160);
      args.onEvent.onmessage({ type: "progress", downloadedBytes: Math.round((total * i) / 10), contentLength: total });
    }
    args.onEvent.onmessage({ type: "installing" });
    return null;
  },

  /* jobs */
  jobs_active: () => [...db.jobs.values()].map((j) => ({ ...j.info })),
  jobs_recent: () => db.recent,
  job_cancel: (args) => {
    const job = db.jobs.get(args.req.jobId);
    if (!job) return false;
    job.cancelled = true;
    return true;
  },

  /* bgremove */
  bgremove_status: () => db.bgremove,
  bgremove_model_preview: (args) => {
    const m = db.bgremove.models.find((x) => x.id === args.req.modelId);
    if (!m) return err({ kind: "notFound", entity: "artifact", id: args.req.modelId });
    const plan: InstallPlan = {
      planId: newId(),
      programId: m.id,
      programName: m.name,
      version: "1.0.0",
      channel: "stable",
      source: {
        label: "huggingface.co (Modellquelle des Kollektivs)",
        host: "huggingface.co",
        url: "https://huggingface.co/cypher-kollektiv/isnet-general-use/resolve/main/model.onnx",
        mirrorRedirects: false,
      },
      artifact: {
        kind: "zip",
        fileName: "isnet-general-use.onnx",
        size: m.size,
        sha256: fakeSha(m.id),
        checksumSource: "https://huggingface.co/cypher-kollektiv/isnet-general-use/blob/main/model.onnx.sha256",
        checksumOrigin: "cypherPinned",
        signature: null,
      },
      license: m.license,
      target: {
        dir: `${PROGRAMS_DIR}\\..\\models\\${m.id}`,
        requiredBytes: m.size * 2,
        availableBytes: 212 * GIB,
        portable: true,
        needsAdmin: false,
      },
      replaces: null,
      existing: [],
      notes: [],
      createdAt: nowIso(),
      expiresAt: iso(10),
    };
    db.plans.set(plan.planId, plan);
    return plan;
  },
  bgremove_model_install: async (args) => {
    const plan = db.plans.get(args.req.planId);
    if (!plan) return err({ kind: "planExpired", planId: args.req.planId });
    checkConsent(plan, args.req.consent);
    const job = startJob("bgremoveModel", plan.programName, null);
    args.onEvent.onmessage({ type: "started", jobId: job.info.id, totalBytes: plan.artifact.size });
    args.onEvent.onmessage({ type: "phase", phase: "download" });
    for (let i = 1; i <= 12; i++) {
      if (job.cancelled) {
        finishJob(job, "cancelled", null, { kind: "none" });
        return err({ kind: "cancelled" });
      }
      await sleepScaled(160);
      args.onEvent.onmessage({
        type: "downloadProgress",
        downloadedBytes: Math.round((plan.artifact.size * i) / 12),
        totalBytes: plan.artifact.size,
        bytesPerSecond: 30 * MIB,
      });
      progressJob(job, i / 12, "download");
    }
    args.onEvent.onmessage({ type: "phase", phase: "verifyChecksum" });
    await sleepScaled(500);
    args.onEvent.onmessage({ type: "verified", sha256: plan.artifact.sha256, signatureChecked: false });
    args.onEvent.onmessage({ type: "phase", phase: "register" });
    await sleepScaled(300);
    db.bgremove = {
      ...db.bgremove,
      runtimeInstalled: true,
      models: db.bgremove.models.map((m) => (m.id === plan.programId ? { ...m, installed: true } : m)),
    };
    finishJob(job, "succeeded", null, { kind: "none" });
    return db.bgremove;
  },
  bgremove_run: async (args) => {
    const sample = sampleOfHandle(args.req.handleId);
    const job = startJob("bgremoveRun", sample.name, null);
    args.onEvent.onmessage({ type: "started", jobId: job.info.id });
    for (const stage of ["load", "infer", "compose", "encode"] as const) {
      await sleepScaled(380);
      args.onEvent.onmessage({ type: "stage", stage });
    }
    args.onEvent.onmessage({ type: "finished" });
    const out: FileHandleInfo = {
      id: `fh-${newId().slice(0, 8)}`,
      name: sample.name.replace(/\.[^.]+$/, "_freigestellt.png"),
      displayPath: `${LIBRARY_ROOT}\\Export\\${sample.name.replace(/\.[^.]+$/, "_freigestellt.png")}`,
      size: 5 * MIB,
      mime: "image/png",
      url: await motifUrl(sample.motif),
      source: "export",
    };
    db.handles.set(out.id, { ...out, sample: sample.name });
    finishJob(job, "succeeded", null, { kind: "file", handle: out });
    return out;
  },
};

export const GARMENT_IDS = GARMENTS.map((g) => g.id);
export { CATALOG };
