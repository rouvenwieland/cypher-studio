import { describe, expect, it } from "vitest";
import type { Installation, JobInfo, ProgramOverview } from "@contract";
import { deriveProgramState, versionText } from "./state";
import { lampOf } from "../../app/stores";

function install(kind: Installation["kind"], version: string, extra: Partial<Installation> = {}): Installation {
  return {
    id: `${kind}:krita:${version}`,
    programId: "krita",
    version,
    kind,
    managedByCypher: kind === "cypher",
    location: "C:\\x\\krita.exe",
    launchable: true,
    problems: [],
    installedAt: null,
    detectedAt: "2026-10-16T12:00:00Z",
    verified: null,
    setupScopeId: "scope",
    ...extra,
  };
}

function program(over: Partial<ProgramOverview> = {}): ProgramOverview {
  return {
    id: "krita",
    name: "Krita",
    vendor: "x",
    category: "raster",
    description: "x",
    license: { spdx: "GPL-3.0-or-later", name: "GPL", url: "" },
    supportedOnThisPlatform: true,
    latest: {
      version: "5.3.1",
      channel: "stable",
      releasedAt: null,
      downloadSize: 100,
      availableForThisPlatform: true,
    },
    installations: [],
    preferredInstallationId: null,
    updateAvailable: false,
    setup: null,
    ...over,
  };
}

const job = (phase: string | null, progress: number | null): JobInfo => ({
  id: "j1",
  kind: "install",
  subject: "Krita",
  startedAt: "",
  cancellable: true,
  progress,
  phase,
  needsAttention: false,
});

describe("Programmstatus (CONCEPT.md 6.2)", () => {
  it("nicht installiert → Installieren", () => {
    const s = deriveProgramState(program(), []);
    expect(s.status).toBe("notInstalled");
    expect(s.action).toBe("install");
    expect(s.versionLabel).toBe("—");
  });
  it("nicht installiert zeigt die Katalogversion: „5.3.1 verfügbar“ statt eines Strichs", () => {
    const s = deriveProgramState(program(), []);
    expect(s.availableVersion).toBe("5.3.1");
    expect(versionText(s)).toBe("5.3.1 verfügbar");
  });
  it("ohne Fassung für dieses System bleibt der Strich ehrlich", () => {
    const none = program({
      latest: {
        version: "5.3.1",
        channel: "stable",
        releasedAt: null,
        downloadSize: 0,
        availableForThisPlatform: false,
      },
    });
    expect(versionText(deriveProgramState(none, []))).toBe("—");
    expect(versionText(deriveProgramState(program({ latest: null }), []))).toBe("—");
  });
  it("Installiertes zeigt seine Version, laufende Aufträge nichts", () => {
    const i = install("cypher", "5.3.1");
    const installed = deriveProgramState(program({ installations: [i], preferredInstallationId: i.id }), []);
    expect(installed.availableVersion).toBeNull();
    expect(versionText(installed)).toBe("5.3.1");
    expect(versionText(deriveProgramState(program(), [job("download", 0.3)]))).toBe("");
  });
  it("laufender Auftrag bestimmt Status und Aktion Abbrechen", () => {
    expect(deriveProgramState(program(), [job("download", 0.3)]).status).toBe("downloading");
    expect(deriveProgramState(program(), [job("verifyChecksum", 0.75)]).status).toBe("verifying");
    expect(deriveProgramState(program(), [job("extract", 0.85)]).status).toBe("installing");
    const s = deriveProgramState(program(), [job("download", 0.3)]);
    expect(s.action).toBe("cancel");
    expect(s.progress).toBe(0.3);
  });
  it("außerhalb von Studio installiert → gefunden, kein Aktualisieren", () => {
    const i = install("system", "4.5.0");
    const s = deriveProgramState(
      program({ installations: [i], preferredInstallationId: i.id, updateAvailable: true }),
      [],
    );
    expect(s.status).toBe("found");
    expect(s.action).toBe("launch");
  });
  it("Update verfügbar zeigt alte → neue Version", () => {
    const i = install("cypher", "5.2.0");
    const s = deriveProgramState(
      program({ installations: [i], preferredInstallationId: i.id, updateAvailable: true }),
      [],
    );
    expect(s.status).toBe("updateAvailable");
    expect(s.versionLabel).toBe("5.2.0 → 5.3.1");
    expect(s.action).toBe("update");
  });
  it("eingerichtet nur mit angewendetem Paket", () => {
    const i = install("cypher", "5.3.1");
    const base = program({ installations: [i], preferredInstallationId: i.id });
    expect(deriveProgramState(base, []).status).toBe("installed");
    const withSetup = program({
      ...base,
      setup: {
        packId: "krita",
        programId: "krita",
        title: "x",
        packVersion: "1",
        requiresPacks: [],
        scopes: [
          {
            scopeId: "s",
            scopeKind: "portableInstall",
            componentsApplied: [],
            targetRoots: [],
            installationIds: [i.id],
            status: "applied",
            record: null,
          },
        ],
      },
    });
    expect(deriveProgramState(withSetup, []).status).toBe("setUp");
  });
  it("fehlende Programmdatei ist ein Fehler", () => {
    const i = install("cypher", "5.3.1", { problems: [{ kind: "executableMissing" }] });
    expect(deriveProgramState(program({ installations: [i], preferredInstallationId: i.id }), []).status).toBe("error");
  });
});

describe("Lampe der Rail", () => {
  const j = (needsAttention: boolean): JobInfo => ({ ...job("download", 0.1), needsAttention });
  it("Form und Priorität: braucht dich vor gescheitert vor läuft", () => {
    expect(lampOf([], 0)).toBe("idle");
    expect(lampOf([j(false)], 0)).toBe("running");
    expect(lampOf([], 2)).toBe("failed");
    expect(lampOf([j(true)], 1)).toBe("attention");
    expect(lampOf([j(false)], 1)).toBe("failed");
  });
});
