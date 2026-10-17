/**
 * Veränderlicher Zustand des Mock-Modus: Programme, Einrichtung, Projekte, Bibliothek, Aufträge.
 * Szenarien (`fresh`, `default`, …) bestimmen den Anfangszustand (ARCHITEKTUR 8.3).
 */
import { emit } from "@tauri-apps/api/event";
import type {
  AppError,
  BgRemoveStatus,
  CatalogStatus,
  FileHandleInfo,
  Installation,
  InstallPlan,
  JobInfo,
  JobKind,
  JobRecord,
  LibraryStatus,
  PlanId,
  ProgramOverview,
  ProgramsView,
  Project,
  SetupComponent,
  SetupComponentKind,
  SetupComponentStatus,
  SetupConflict,
  SetupOperation,
  SetupPlan,
  SetupRecord,
  SetupScope,
  SetupStatus,
  SetupSummary,
  Settings,
  TemplateInfo,
  UpdateCheck,
} from "@contract";
import { compareVersions } from "../../lib/version";
import { now, nowIso } from "../../lib/clock";
import {
  CATALOG,
  COLLECTIONS,
  defaultSettings,
  fakeSha,
  GIB,
  LIBRARY_ROOT,
  LINKS,
  MIB,
  PALETTES,
  PROGRAMS_DIR,
  type CatalogProgram,
} from "./fixtures";
import { generateLibrary, projectsSeed, templatesSeed, type LibraryModel } from "./library";
import { uuid } from "./rng";

export type ScenarioName =
  | "default"
  | "fresh"
  | "allInstalled"
  | "busy"
  | "installChecksumFail"
  | "installNetworkFail"
  | "setupConflicts"
  | "setupLocked"
  | "library5000"
  | "offline"
  | "updateAvailable"
  | "folderLost"
  | "libraryEmpty"
  | "onboardingPartial";

export const SCENARIOS: readonly ScenarioName[] = [
  "default",
  "fresh",
  "allInstalled",
  "busy",
  "installChecksumFail",
  "installNetworkFail",
  "setupConflicts",
  "setupLocked",
  "library5000",
  "offline",
  "updateAvailable",
  "folderLost",
  "libraryEmpty",
  "onboardingPartial",
];

export interface ActiveJob {
  info: JobInfo;
  cancelled: boolean;
  programId: string | null;
  lastEmit: number;
}

export interface PackComponentDef {
  id: string;
  kind: SetupComponentKind;
  label: string;
  optional: boolean;
  targets: string[];
  bytes: number;
  preview: { colors: string[]; formats: string[]; fonts: string[] };
}

export interface PackDef {
  packId: string;
  programId: string | null;
  components: PackComponentDef[];
}

const ROAMING = `C:\\Users\\Lena\\AppData\\Roaming`;
const FONT_NAMES = ["Anybody", "Atkinson Hyperlegible Next", "Martian Mono"];
const PALETTE_COLORS = PALETTES[0]?.colors.map((c) => c.hex) ?? [];

export const PACKS: Record<string, PackDef> = {
  krita: {
    packId: "krita",
    programId: "krita",
    components: [
      {
        id: "palette",
        kind: "palette",
        label: "Palette „Cypher Kollektionen“",
        optional: false,
        targets: [`${ROAMING}\\krita\\palettes\\cypher.kpl`],
        bytes: 2_400,
        preview: { colors: PALETTE_COLORS, formats: [], fonts: [] },
      },
      {
        id: "fonts",
        kind: "fonts",
        label: "Schriften",
        optional: false,
        targets: [`${ROAMING}\\krita\\fonts\\cypher\\`],
        bytes: 1_240_000,
        preview: { colors: [], formats: [], fonts: FONT_NAMES },
      },
      {
        id: "templates",
        kind: "templates",
        label: "Vorlagen",
        optional: false,
        targets: [`${ROAMING}\\krita\\template\\cypher\\`],
        bytes: 4_800_000,
        preview: {
          colors: [],
          formats: ["Shirt vorne 330 × 450 mm", "Hoodie vorne 330 × 280 mm", "Post 1080 × 1350", "Story 1080 × 1920"],
          fonts: [],
        },
      },
      {
        id: "workspace",
        kind: "workspace",
        label: "Arbeitsfläche „Cypher“",
        optional: true,
        targets: [`${ROAMING}\\krita\\workspaces\\cypher.kws`],
        bytes: 18_000,
        preview: { colors: [], formats: [], fonts: [] },
      },
    ],
  },
  inkscape: {
    packId: "inkscape",
    programId: "inkscape",
    components: [
      {
        id: "palette",
        kind: "palette",
        label: "Palette „Cypher Kollektionen“",
        optional: false,
        targets: [`${ROAMING}\\inkscape\\palettes\\cypher.gpl`],
        bytes: 1_100,
        preview: { colors: PALETTE_COLORS, formats: [], fonts: [] },
      },
      {
        id: "fonts",
        kind: "fonts",
        label: "Schriften",
        optional: false,
        targets: [`${ROAMING}\\inkscape\\fonts\\`],
        bytes: 1_240_000,
        preview: { colors: [], formats: [], fonts: FONT_NAMES },
      },
      {
        id: "templates",
        kind: "templates",
        label: "Vorlagen mit Druckfläche in Millimetern",
        optional: false,
        targets: [`${ROAMING}\\inkscape\\templates\\`],
        bytes: 90_000,
        preview: {
          colors: [],
          formats: ["Shirt 330 × 450 mm", "Hoodie 330 × 280 mm", "Post 1080 × 1350 px", "Story 1080 × 1920 px"],
          fonts: [],
        },
      },
    ],
  },
  blender: {
    packId: "blender",
    programId: "blender",
    components: [
      {
        id: "appTemplate",
        kind: "appTemplate",
        label: "App-Vorlage „cypher_ps2“",
        optional: false,
        targets: [`${PROGRAMS_DIR}\\blender\\5.2.2\\portable\\scripts\\startup\\bl_app_templates_user\\cypher_ps2\\`],
        bytes: 3_200_000,
        preview: { colors: [], formats: [], fonts: [] },
      },
      {
        id: "extension",
        kind: "extension",
        label: "Erweiterung „Cypher Export“",
        optional: false,
        targets: [`${PROGRAMS_DIR}\\blender\\5.2.2\\portable\\extensions\\cypher_export\\`],
        bytes: 220_000,
        preview: { colors: [], formats: [], fonts: [] },
      },
      {
        id: "assetLibrary",
        kind: "assetLibrary",
        label: "Asset-Bibliothek auf „3D“ im gemeinsamen Ordner",
        optional: false,
        targets: [`${LIBRARY_ROOT}\\3D\\`],
        bytes: 600,
        preview: { colors: [], formats: [], fonts: [] },
      },
    ],
  },
  kdenlive: {
    packId: "kdenlive",
    programId: "kdenlive",
    components: [
      {
        id: "titles",
        kind: "titles",
        label: "Titelvorlagen mit Cypher-Schriften",
        optional: false,
        targets: [`${ROAMING}\\kdenlive\\titles\\`],
        bytes: 140_000,
        preview: { colors: [], formats: [], fonts: FONT_NAMES },
      },
      {
        id: "videoProfiles",
        kind: "videoProfiles",
        label: "Projektprofile 1080 × 1920 und 1080 × 1350",
        optional: false,
        targets: [`${ROAMING}\\kdenlive\\profiles\\`],
        bytes: 2_100,
        preview: { colors: [], formats: ["1080 × 1920 · 30 fps", "1080 × 1350 · 30 fps"], fonts: [] },
      },
      {
        id: "renderPreset",
        kind: "renderPreset",
        label: "Render-Profil „Reel (H.264, 1080 × 1920)“",
        optional: true,
        targets: [`${ROAMING}\\kdenlive\\export\\`],
        bytes: 1_800,
        preview: { colors: [], formats: [], fonts: [] },
      },
    ],
  },
  fonts: {
    packId: "fonts",
    programId: null,
    components: [
      {
        id: "fonts",
        kind: "fonts",
        label: "Cypher-Schriften für alle Programme",
        optional: false,
        targets: [`C:\\Users\\Lena\\AppData\\Local\\Microsoft\\Windows\\Fonts\\`],
        bytes: 1_240_000,
        preview: { colors: [], formats: [], fonts: FONT_NAMES },
      },
    ],
  },
};

export interface PackState {
  components: Record<string, SetupComponentStatus>;
  history: SetupRecord[];
  /** Zustand vor der letzten Anwendung, für „Rückgängig“ */
  before: Record<string, SetupComponentStatus> | null;
}

export interface MockDb {
  scenario: ScenarioName;
  /** Alle Teile eines zusammengesetzten Szenarios („fresh+installNetworkFail“) */
  flags: Set<string>;
  speed: number;
  settings: Settings;
  catalog: CatalogStatus;
  installations: Record<string, Installation[]>;
  preferred: Record<string, string>;
  setup: Record<string, PackState>;
  projects: Project[];
  templates: TemplateInfo[];
  library: LibraryModel | null;
  libraryStatus: LibraryStatus;
  handles: Map<string, FileHandleInfo & { sample?: string; blobFile?: boolean }>;
  plans: Map<PlanId, InstallPlan>;
  setupPlans: Map<PlanId, { plan: SetupPlan; createdAt: number }>;
  jobs: Map<string, ActiveJob>;
  recent: JobRecord[];
  update: UpdateCheck;
  bgremove: BgRemoveStatus;
  calls: { cmd: string; args: unknown }[];
  pickIndex: number;
}

export let db: MockDb = createDb("default");

export function resetDb(scenario: string): MockDb {
  db = createDb(scenario);
  return db;
}

function rec(): number {
  return Math.random();
}

export function newId(): string {
  return uuid(rec);
}

export function sleepScaled(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms / db.speed)));
}

export function iso(minutesFromNow: number): string {
  return new Date(now().getTime() + minutesFromNow * 60_000).toISOString();
}

function winPath(program: CatalogProgram, version: string): string {
  const exe =
    program.id === "kdenlive"
      ? "bin\\kdenlive.exe"
      : program.id === "blender"
        ? "blender.exe"
        : program.id === "krita"
          ? "bin\\krita.exe"
          : "bin\\inkscape.exe";
  return `${PROGRAMS_DIR}\\${program.id}\\${version}\\${exe}`;
}

export function makeInstallation(
  program: CatalogProgram,
  version: string,
  kind: Installation["kind"] = "cypher",
): Installation {
  const location =
    kind === "cypher" ? winPath(program, version) : `C:\\Program Files\\${program.name}\\${program.id}.exe`;
  const stale = compareVersions(version, program.latest) < 0;
  return {
    id: kind === "cypher" ? `cypher:${program.id}:${version}` : `system:${program.id}:${program.id.length}a`,
    programId: program.id,
    version,
    kind,
    managedByCypher: kind === "cypher",
    location,
    launchable: true,
    problems: stale ? [{ kind: "staleCatalogVersion", latest: program.latest }] : [],
    installedAt: kind === "cypher" ? iso(-60 * 24 * 6) : null,
    detectedAt: iso(-12),
    verified:
      kind === "cypher"
        ? { sha256: fakeSha(`${program.id}${version}`), catalogSequence: 42, signatureChecked: false }
        : null,
    setupScopeId: `scope:${program.id}:${kind}`,
  };
}

function allCurrent(packId: string): Record<string, SetupComponentStatus> {
  const def = PACKS[packId];
  const out: Record<string, SetupComponentStatus> = {};
  for (const c of def?.components ?? []) out[c.id] = c.optional ? "new" : "current";
  return out;
}

function allNew(packId: string): Record<string, SetupComponentStatus> {
  const out: Record<string, SetupComponentStatus> = {};
  for (const c of PACKS[packId]?.components ?? []) out[c.id] = "new";
  return out;
}

export function createDb(scenarioText: string): MockDb {
  const parts = scenarioText.split("+");
  const flags = new Set(parts);
  const first = parts[0] ?? "default";
  const scenario: ScenarioName = (SCENARIOS as readonly string[]).includes(first) ? (first as ScenarioName) : "default";
  const speed =
    typeof window !== "undefined"
      ? Number((window as unknown as { __CYPHER_MOCK_SPEED__?: number }).__CYPHER_MOCK_SPEED__) || 1
      : 1;
  const stamp = nowIso();
  const settings = defaultSettings(stamp);
  const fresh = scenario === "fresh";
  if (fresh)
    settings.onboarding = {
      status: "notStarted",
      step: 0,
      selectedPrograms: ["krita", "inkscape"],
      applySetup: true,
      updatedAt: null,
    };
  if (scenario === "onboardingPartial")
    settings.onboarding = {
      status: "inProgress",
      step: 4,
      selectedPrograms: ["krita", "inkscape"],
      applySetup: true,
      updatedAt: stamp,
    };
  if (fresh || scenario === "libraryEmpty") settings.libraryRoot = null;
  const installations: Record<string, Installation[]> = { krita: [], inkscape: [], blender: [], kdenlive: [] };
  const setup: Record<string, PackState> = {};
  for (const packId of Object.keys(PACKS)) setup[packId] = { components: allNew(packId), history: [], before: null };
  const k = CATALOG.find((p) => p.id === "krita");
  const i = CATALOG.find((p) => p.id === "inkscape");
  const b = CATALOG.find((p) => p.id === "blender");
  const d = CATALOG.find((p) => p.id === "kdenlive");
  if (!fresh && scenario !== "onboardingPartial" && k && i && b && d) {
    // Beispiel für ein Update: Krita 5.3.3 → 5.3.4.1; Inkscape ist aktuell
    installations["krita"] = [makeInstallation(k, "5.3.3")];
    installations["inkscape"] = [makeInstallation(i, "1.4.4")];
    if (scenario === "allInstalled") {
      installations["krita"] = [makeInstallation(k, "5.3.4.1")];
      installations["blender"] = [makeInstallation(b, "5.2.2")];
      installations["kdenlive"] = [makeInstallation(d, "26.08.2")];
    } else if (
      scenario === "default" ||
      scenario === "busy" ||
      scenario === "setupConflicts" ||
      scenario === "setupLocked"
    ) {
      installations["blender"] = [makeInstallation(b, "4.2.3", "system")];
      installations["blender"] = [];
    }
    setup["krita"] = { components: allCurrent("krita"), history: [], before: null };
    setup["inkscape"] = { components: allCurrent("inkscape"), history: [], before: null };
    setup["fonts"] = { components: allCurrent("fonts"), history: [], before: null };
    if (scenario === "allInstalled") {
      setup["blender"] = { components: allCurrent("blender"), history: [], before: null };
      setup["kdenlive"] = { components: allCurrent("kdenlive"), history: [], before: null };
    }
    if (scenario === "setupConflicts" || scenario === "setupLocked") {
      setup["krita"] = {
        components: { palette: "current", fonts: "outdated", templates: "new", workspace: "userModified" },
        history: [],
        before: null,
      };
    }
  }
  const projects = fresh || scenario === "libraryEmpty" ? [] : projectsSeed(now());
  const count = scenario === "library5000" ? 5000 : 3104;
  const library = fresh || scenario === "libraryEmpty" ? null : generateLibrary(count, now(), projects);
  const libraryStatus: LibraryStatus = library
    ? {
        configured: true,
        root: LIBRARY_ROOT,
        initialized: true,
        formatVersion: 1,
        entryCount: library.entries.length,
        totalBytes: 41 * GIB,
        projectCount: projects.length,
        conflictCount: library.entries.filter((e) => e.conflict).length,
        lastScanAt: iso(-25),
        syncTool: "syncthing",
        watching: true,
        collections: COLLECTIONS,
      }
    : {
        configured: false,
        root: null,
        initialized: false,
        formatVersion: null,
        entryCount: 0,
        totalBytes: 0,
        projectCount: 0,
        conflictCount: 0,
        lastScanAt: null,
        syncTool: null,
        watching: false,
        collections: COLLECTIONS,
      };
  const offline = scenario === "offline";
  const lastError: AppError | null = offline
    ? { kind: "network", host: "studio.cypherxcypher.de", message: "Keine Verbindung", retryable: true }
    : null;
  const catalog: CatalogStatus = {
    sourceUrl: "https://studio.cypherxcypher.de/catalog/v1/catalog.json",
    schemaVersion: 1,
    sequence: 42,
    generatedAt: iso(-60 * 24 * 3),
    expiresAt: iso(60 * 24 * 40),
    expired: false,
    source: offline ? "cache" : "remote",
    lastCheckAt: iso(-90),
    lastError,
  };
  const update: UpdateCheck =
    scenario === "updateAvailable"
      ? {
          available: true,
          currentVersion: "0.4.0",
          version: "0.5.0",
          date: iso(-60 * 5),
          notes:
            "Mockups: Kontaktbogen für alle Textilfarben.\nSocial: neue Vorlage „Termin“.\nDruckprüfer: dünne Linien werden jetzt gemessen.",
          checkedAt: iso(-3),
        }
      : { available: false, currentVersion: "0.4.0", version: null, date: null, notes: null, checkedAt: iso(-90) };
  const db: MockDb = {
    scenario,
    flags,
    speed,
    settings,
    catalog,
    installations,
    preferred: {},
    setup,
    projects,
    templates: templatesSeed(),
    library,
    libraryStatus,
    handles: new Map(),
    plans: new Map(),
    setupPlans: new Map(),
    jobs: new Map(),
    recent: [],
    update,
    bgremove: {
      colorKeyAvailable: true,
      modelFeature: true,
      runtimeInstalled: false,
      models: [
        {
          id: "isnet-general-use",
          name: "IS-Net general use",
          license: {
            spdx: "Apache-2.0",
            name: "Apache License 2.0",
            url: "https://www.apache.org/licenses/LICENSE-2.0",
          },
          size: 176 * MIB,
          installed: false,
          notice: "Das Modell wurde mit Bildern unklarer Herkunft trainiert. Die Ergebnisse gehören dir.",
        },
      ],
    },
    calls: [],
    pickIndex: 0,
  };
  return db;
}

/* ---------- Aufträge ---------- */

export function jobInfos(): JobInfo[] {
  return [...db.jobs.values()].map((j) => ({ ...j.info }));
}

export function emitJobs(finished: JobRecord | null): void {
  void emit("jobs:changed", { active: jobInfos(), finished });
}

export function startJob(kind: JobKind, subject: string, programId: string | null, cancellable = true): ActiveJob {
  const job: ActiveJob = {
    info: {
      id: newId(),
      kind,
      subject,
      startedAt: nowIso(),
      cancellable,
      progress: 0,
      phase: null,
      needsAttention: false,
    },
    cancelled: false,
    programId,
    lastEmit: 0,
  };
  db.jobs.set(job.info.id, job);
  emitJobs(null);
  return job;
}

export function progressJob(job: ActiveJob, progress: number | null, phase: string | null): void {
  job.info = { ...job.info, progress, phase };
  const t = Date.now();
  if (t - job.lastEmit > 480) {
    job.lastEmit = t;
    emitJobs(null);
  }
}

export function finishJob(
  job: ActiveJob,
  outcome: JobRecord["outcome"],
  error: AppError | null,
  result: JobRecord["result"],
): void {
  db.jobs.delete(job.info.id);
  const record: JobRecord = {
    info: { ...job.info, progress: outcome === "succeeded" ? 1 : job.info.progress },
    finishedAt: nowIso(),
    outcome,
    error,
    result,
  };
  db.recent.unshift(record);
  emitJobs(record);
}

/* ---------- Programme ---------- */

export function setupStatusOf(packId: string, installed: boolean): SetupStatus {
  if (!installed) return "notApplied";
  const st = db.setup[packId];
  if (!st) return "unsupported";
  const required = (PACKS[packId]?.components ?? [])
    .filter((c) => !c.optional)
    .map((c) => st.components[c.id] ?? "new");
  if (required.every((s) => s === "current")) return "applied";
  if (required.every((s) => s === "new")) return "notApplied";
  if (required.some((s) => s === "outdated")) return "outdated";
  return "partial";
}

export function setupSummary(packId: string, program: CatalogProgram | null): SetupSummary {
  const def = PACKS[packId];
  const installations = program ? (db.installations[program.id] ?? []) : [];
  const state = db.setup[packId];
  const scopes: SetupScope[] = installations.map((inst) => {
    const status = setupStatusOf(packId, true);
    const record = state?.history.find((r) => r.status !== "undone") ?? null;
    return {
      scopeId: inst.setupScopeId ?? `scope:${inst.id}`,
      scopeKind: inst.kind === "cypher" ? "portableInstall" : "userProfile",
      componentsApplied: Object.entries(state?.components ?? {})
        .filter(([, s]) => s === "current")
        .map(([id]) => id),
      targetRoots: def?.components.flatMap((c) => c.targets).slice(0, 2) ?? [],
      installationIds: [inst.id],
      status,
      record,
    };
  });
  return {
    packId,
    programId: program?.id ?? null,
    title: program ? program.pack.title : "Cypher-Schriften",
    packVersion: program?.pack.version ?? "2026.10.0",
    requiresPacks: packId === "fonts" ? [] : ["fonts"],
    scopes,
  };
}

export function programOverview(p: CatalogProgram): ProgramOverview {
  const installs = db.installations[p.id] ?? [];
  const cy = installs.find((x) => x.kind === "cypher");
  const updateAvailable = !!cy?.version && compareVersions(cy.version, p.latest) < 0;
  const preferred = db.preferred[p.id] ?? cy?.id ?? installs[0]?.id ?? null;
  return {
    id: p.id,
    name: p.name,
    vendor: p.vendor,
    category: p.category,
    description: p.description,
    license: p.license,
    supportedOnThisPlatform: true,
    latest: {
      version: p.latest,
      channel: p.channel,
      releasedAt: p.releasedAt,
      downloadSize: p.downloadSize,
      availableForThisPlatform: true,
    },
    installations: installs.map((x) => ({
      ...x,
      problems:
        x.kind === "cypher" && x.version && compareVersions(x.version, p.latest) < 0
          ? [{ kind: "staleCatalogVersion" as const, latest: p.latest }]
          : x.problems,
    })),
    preferredInstallationId: preferred,
    updateAvailable,
    setup: setupSummary(p.pack.packId, p),
  };
}

export function programsView(): ProgramsView {
  return { programs: CATALOG.map(programOverview), links: LINKS, catalog: db.catalog };
}

export function catalogProgram(id: string): CatalogProgram | undefined {
  return CATALOG.find((p) => p.id === id);
}

/* ---------- Einrichtung ---------- */

export function buildSetupPlan(packId: string, scopeId: string): SetupPlan {
  const def = PACKS[packId];
  const program = def?.programId ? catalogProgram(def.programId) : undefined;
  const state = db.setup[packId];
  const components: SetupComponent[] = [];
  const conflicts: SetupConflict[] = [];
  for (const c of def?.components ?? []) {
    const status = state?.components[c.id] ?? "new";
    const operations: SetupOperation[] = c.targets.map((target) => {
      const base = { target, sourceId: `${packId}/${c.id}`, bytes: c.bytes, conflictId: null as string | null };
      switch (status) {
        case "current":
          return { ...base, kind: "skip" as const };
        case "new":
          return { ...base, kind: c.kind === "fonts" ? ("installFont" as const) : ("create" as const) };
        case "outdated":
        case "partial":
          return { ...base, kind: "update" as const };
        case "userModified": {
          const conflictId = `c-${packId}-${c.id}`;
          conflicts.push({
            conflictId,
            componentId: c.id,
            target,
            reason: "userModified",
            keepBothName: `cypher-2026-10${target.includes(".") ? target.slice(target.lastIndexOf(".")) : ""}`,
          });
          return { ...base, kind: "conflict" as const, conflictId };
        }
      }
    });
    components.push({
      id: c.id,
      kind: c.kind,
      label: c.label,
      optional: c.optional,
      defaultSelected: !c.optional || status === "userModified",
      status,
      preview: c.preview,
      operations,
    });
  }
  const last = state?.history.find((r) => r.status !== "undone") ?? null;
  const plan: SetupPlan = {
    planId: newId(),
    packId,
    programId: def?.programId ?? null,
    scopeId,
    packVersion: program?.pack.version ?? "2026.10.0",
    packLabel: "Cypher-Paket 2026.10",
    previous: last,
    components,
    conflicts,
    programRunning: packId === "krita" && db.flags.has("setupConflicts"),
    restartHint: packId !== "fonts",
    createdAt: nowIso(),
    expiresAt: iso(10),
  };
  db.setupPlans.set(plan.planId, { plan, createdAt: Date.now() });
  return plan;
}
