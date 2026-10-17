import { beforeEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { COMMAND_NAMES, type InstallEvent } from "@contract";
import { handlers } from "./handlers";
import { db, resetDb } from "./state";
import { generateLibrary, projectsSeed, queryLibrary } from "./library";
import { SAMPLES, analyze } from "./printcheck";
import { PRINT_PROFILES } from "./fixtures";
import { now } from "../../lib/clock";

type AnyHandler = (args: unknown) => unknown;
const h = handlers as unknown as Record<string, AnyHandler>;

beforeEach(() => {
  (window as unknown as { __CYPHER_MOCK_SPEED__?: number }).__CYPHER_MOCK_SPEED__ = 2000;
  mockIPC(() => undefined, { shouldMockEvents: true });
});

describe("Mock-Handler (ARCHITEKTUR 8.2)", () => {
  it("bedient ALLE Commands des Vertrags", () => {
    expect(Object.keys(handlers).sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it("liefert Programme mit Installationen nach Szenario", async () => {
    resetDb("default");
    const view = (await h["programs_list"]?.({})) as {
      programs: { id: string; installations: unknown[]; updateAvailable: boolean }[];
    };
    expect(view.programs.map((p) => p.id)).toEqual(["krita", "inkscape", "blender", "kdenlive"]);
    expect(view.programs.find((p) => p.id === "krita")?.updateAvailable).toBe(true);
    expect(view.programs.find((p) => p.id === "blender")?.installations).toHaveLength(0);
  });

  it("install_preview zeigt die sechs Felder", async () => {
    resetDb("default");
    const plan = (await h["install_preview"]?.({ req: { programId: "blender" } })) as {
      source: { host: string };
      version: string;
      artifact: { size: number; sha256: string };
      license: { spdx: string };
      target: { dir: string };
    };
    expect(plan.source.host).toBe("download.blender.org");
    expect(plan.version).toBe("5.2.2");
    expect(plan.artifact.sha256).toHaveLength(64);
    expect(plan.license.spdx).toBe("GPL-3.0-or-later");
    expect(plan.target.dir).toContain("blender");
  });

  it(
    "Installation läuft in der vertraglichen Reihenfolge und trägt das Programm ein",
    { timeout: 30_000 },
    async () => {
      resetDb("default");
      const plan = (await h["install_preview"]?.({ req: { programId: "blender" } })) as {
        planId: string;
        artifact: { sha256: string };
        license: { spdx: string };
        target: { dir: string };
      };
      const events: InstallEvent[] = [];
      const result = (await h["install_start"]?.({
        req: {
          planId: plan.planId,
          consent: {
            planId: plan.planId,
            sha256: plan.artifact.sha256,
            licenseSpdx: plan.license.spdx,
            targetDir: plan.target.dir,
            acceptedAt: new Date().toISOString(),
          },
        },
        onEvent: { onmessage: (e: InstallEvent) => events.push(e) },
      })) as { programId: string; version: string };
      expect(result.programId).toBe("blender");
      const types = events.map((e) => (e.type === "phase" ? `phase:${e.phase}` : e.type));
      expect(types[0]).toBe("started");
      expect(types).toContain("downloadProgress");
      expect(types.indexOf("phase:download")).toBeLessThan(types.indexOf("phase:verifyChecksum"));
      expect(types.indexOf("verified")).toBeLessThan(types.indexOf("phase:extract"));
      expect(types.indexOf("phase:extract")).toBeLessThan(types.indexOf("phase:register"));
      expect(types[types.length - 1]).toBe("finished");
      expect(db.installations["blender"]).toHaveLength(1);
    },
  );

  it("falsche Zustimmung wird abgelehnt (consentMismatch)", async () => {
    resetDb("default");
    const plan = (await h["install_preview"]?.({ req: { programId: "krita" } })) as {
      planId: string;
      artifact: { sha256: string };
      license: { spdx: string };
      target: { dir: string };
    };
    await expect(
      Promise.resolve(
        h["install_start"]?.({
          req: {
            planId: plan.planId,
            consent: {
              planId: plan.planId,
              sha256: "0".repeat(64),
              licenseSpdx: plan.license.spdx,
              targetDir: plan.target.dir,
              acceptedAt: "",
            },
          },
          onEvent: { onmessage: () => undefined },
        }),
      ),
    ).rejects.toMatchObject({ kind: "consentMismatch" });
  });

  it("Prüfsummenfehler: nichts installiert, Fehler mit beiden Summen", { timeout: 30_000 }, async () => {
    resetDb("installChecksumFail");
    const plan = (await h["install_preview"]?.({ req: { programId: "blender" } })) as {
      planId: string;
      artifact: { sha256: string };
      license: { spdx: string };
      target: { dir: string };
    };
    const events: InstallEvent[] = [];
    await expect(
      Promise.resolve(
        h["install_start"]?.({
          req: {
            planId: plan.planId,
            consent: {
              planId: plan.planId,
              sha256: plan.artifact.sha256,
              licenseSpdx: plan.license.spdx,
              targetDir: plan.target.dir,
              acceptedAt: "",
            },
          },
          onEvent: { onmessage: (e: InstallEvent) => events.push(e) },
        }),
      ),
    ).rejects.toMatchObject({ kind: "checksumMismatch", expected: plan.artifact.sha256 });
    expect(events.some((e) => e.type === "finished")).toBe(false);
    expect(db.installations["blender"]).toHaveLength(0);
    expect(db.recent[0]?.outcome).toBe("failed");
  });

  it("Einrichtung: Konflikt, Anwenden, Rückgängig", async () => {
    resetDb("setupConflicts");
    const view = (await h["programs_list"]?.({})) as {
      programs: { id: string; setup: { packId: string; scopes: { scopeId: string }[] } }[];
    };
    const krita = view.programs.find((p) => p.id === "krita");
    const scopeId = krita?.setup.scopes[0]?.scopeId ?? "";
    const plan = (await h["setup_preview"]?.({ req: { packId: "krita", scopeId } })) as {
      planId: string;
      conflicts: { conflictId: string }[];
      components: { id: string; status: string }[];
    };
    expect(plan.components.map((c) => c.status)).toEqual(["current", "outdated", "new", "userModified"]);
    expect(plan.conflicts).toHaveLength(1);
    const record = (await h["setup_apply"]?.({
      req: {
        planId: plan.planId,
        components: ["palette", "fonts", "templates", "workspace"],
        resolutions: { [plan.conflicts[0]?.conflictId ?? ""]: "keepBoth" },
      },
      onEvent: { onmessage: () => undefined },
    })) as { setupId: string; status: string; undoAvailable: boolean };
    expect(record.status).toBe("applied");
    const after = (await h["setup_preview"]?.({ req: { packId: "krita", scopeId } })) as {
      components: { status: string }[];
    };
    expect(after.components.every((c) => c.status === "current")).toBe(true);
    const undo = (await h["setup_undo"]?.({ req: { setupId: record.setupId } })) as { restored: number };
    expect(undo.restored).toBeGreaterThanOrEqual(0);
    const again = (await h["setup_preview"]?.({ req: { packId: "krita", scopeId } })) as {
      components: { status: string }[];
    };
    expect(again.components.map((c) => c.status)).toEqual(["current", "outdated", "new", "userModified"]);
  });
});

describe("Bibliothek (Mock)", () => {
  it("erzeugt 3.104 Einträge mit den Zahlen aus CONCEPT.md", () => {
    const lib = generateLibrary(3104, now(), projectsSeed(now()));
    expect(lib.entries).toHaveLength(3104);
    const page = queryLibrary(lib, { limit: 50 });
    expect(page.total).toBe(3104);
    expect(page.entries).toHaveLength(50);
    expect(page.facets.kinds.image).toBe(1840);
    expect(page.facets.kinds.vector).toBe(412);
    expect(page.facets.kinds.model3d).toBe(96);
    expect(page.facets.kinds.video).toBe(38);
  });
  it("Filter wirken und zählen mit", () => {
    const lib = generateLibrary(3104, now(), projectsSeed(now()));
    const rauschen = queryLibrary(lib, { collections: ["rauschen"], kinds: ["image"], limit: 10 });
    expect(rauschen.total).toBeGreaterThan(0);
    expect(rauschen.entries.every((e) => e.meta.collection === "rauschen" && e.kind === "image")).toBe(true);
    const none = queryLibrary(lib, { text: "gibt-es-nicht-xyz" });
    expect(none.total).toBe(0);
    const sorted = queryLibrary(lib, { sort: "nameAsc", limit: 20 });
    const names = sorted.entries.map((e) => e.fileName);
    expect([...names].sort((a, b) => a.localeCompare(b, "de"))).toEqual(names);
  });
  it("5.000 Einträge sind in unter 100 ms abgefragt", () => {
    const lib = generateLibrary(5000, now(), projectsSeed(now()));
    const t0 = performance.now();
    queryLibrary(lib, { collections: ["mittelwelle"], limit: 200 });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("Druckregeln (Mock) nach CONCEPT.md 6.4", () => {
  const profile = PRINT_PROFILES[0];
  if (!profile) throw new Error("Profil fehlt");
  const sample = (name: string) => {
    const s = SAMPLES[name];
    if (!s) throw new Error(name);
    return s;
  };
  it("signal_v3.png: druckbar mit Hinweisen, 300 dpi bei 280 mm", () => {
    const r = analyze(
      { sample: sample("signal_v3.png"), profile, garmentColorId: "schwarz", technique: "dtg", plannedWidthMm: 280 },
      new Date().toISOString(),
    );
    expect(r.verdict).toBe("warning");
    expect(r.placement.effectiveDpi).toBeCloseTo(300, 0);
    expect(r.findings.map((f) => f.ruleId)).toEqual(
      expect.arrayContaining(["alpha.semiTransparent", "detail.thinLines"]),
    );
    expect(r.findings.some((f) => f.severity === "error")).toBe(false);
  });
  it("die Auflösung folgt der Druckbreite", () => {
    const wide = analyze(
      { sample: sample("signal_v3.png"), profile, garmentColorId: "schwarz", technique: "dtg", plannedWidthMm: 330 },
      "",
    );
    expect(wide.placement.effectiveDpi).toBeCloseTo(254.6, 0);
    expect(wide.findings.some((f) => f.ruleId === "resolution.belowTarget")).toBe(true);
    expect(wide.placement.maxWidthMmAtTargetDpi).toBeCloseTo(279.9, 0);
  });
  it("JPEG ohne Alpha ist ein Fehler, kleines Bild ebenso", () => {
    expect(
      analyze(
        {
          sample: sample("schriftzug_foto.jpg"),
          profile,
          garmentColorId: "schwarz",
          technique: "dtg",
          plannedWidthMm: 280,
        },
        "",
      ).verdict,
    ).toBe("error");
    expect(
      analyze(
        {
          sample: sample("kleines_motiv.png"),
          profile,
          garmentColorId: "schwarz",
          technique: "dtg",
          plannedWidthMm: 280,
        },
        "",
      ).findings.some((f) => f.ruleId === "resolution.tooLow"),
    ).toBe(true);
  });
  it("DTF macht Halbtransparenz zum Fehler", () => {
    const r = analyze(
      { sample: sample("signal_v3.png"), profile, garmentColorId: "schwarz", technique: "dtf", plannedWidthMm: 280 },
      "",
    );
    expect(r.findings.find((f) => f.ruleId === "alpha.semiTransparent")?.severity).toBe("error");
  });
  it("Logo mit Reinfarbe ist druckbereit", () => {
    const r = analyze(
      {
        sample: sample("rauschen_logo.png"),
        profile,
        garmentColorId: "schwarz",
        technique: "dtg",
        plannedWidthMm: 280,
      },
      "",
    );
    expect(r.findings.filter((f) => f.severity !== "info")).toHaveLength(0);
    expect(r.verdict).toBe("ok");
  });
});
