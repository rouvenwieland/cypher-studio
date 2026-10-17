/**
 * Lokaler Test-Server und signierter Test-Katalog für die E2E-Suite: kleine Fixture-Programme statt echter Downloads
 * (BAU-REGELN 9). Der Katalog ist der echte `catalog/catalog.json` mit zusätzlichen Fixture-Versionen, höherer Folge
 * und einer Signatur des Testschlüssels.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestKey, type TestKey } from "./minisign";
import { writeZip } from "./zip";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "..", "..", "..", "..");

export const FIXTURE_VERSION = { krita: "5.9.9", inkscape: "1.9.9" } as const;

export interface Fixtures {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** Anzahl der Anfragen je Pfad */
  hits: Map<string, number>;
  catalog: { json: string; signature: string };
  key: TestKey;
  /** SHA-256 der guten Krita-Fixture */
  kritaSha256: string;
  /** Inhalt, den die Fixture nach dem Entpacken in `bin/krita.exe` haben muss */
  kritaExeSha256: string;
  close(): Promise<void>;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function fixtureZip(name: string, seed: string): { zip: Buffer; exe: Buffer } {
  // Der „Programmdatei“-Inhalt ist deterministisch zufällig (nicht komprimierbar), aber klein
  const exe = Buffer.concat([Buffer.from("MZ-E2E-FIXTURE:" + seed + "\n"), randomBytes(48 * 1024)]);
  const zip = writeZip([
    {
      name: `${name}/README.txt`,
      data: Buffer.from(`Fixture für die E2E-Suite von Cypher Studio (${name}). Kein echtes Programm.\n`),
    },
    { name: `${name}/bin/${name}.exe`, data: exe },
  ]);
  return { zip, exe };
}

export interface CatalogOptions {
  /** Ablauf des Katalogs in Tagen ab jetzt (negativ = abgelaufen) */
  expiresInDays?: number;
}

export async function startFixtures(opts: CatalogOptions = {}): Promise<Fixtures> {
  const krita = fixtureZip("krita", "krita");
  const inkscape = fixtureZip("inkscape", "inkscape");
  // Inkscape: Der Katalog nennt die Summe der guten Datei, der Server liefert eine veränderte (ein Byte gedreht)
  const inkscapeServed = Buffer.from(inkscape.zip);
  const flip = Math.floor(inkscapeServed.length / 2);
  inkscapeServed[flip] = (inkscapeServed[flip] ?? 0) ^ 0xff;

  const routes = new Map<string, Buffer>([
    ["/krita-fixture.zip", krita.zip],
    ["/inkscape-fixture.zip", inkscapeServed],
  ]);
  const hits = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const body = routes.get(path);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : body.length - 1;
      res.writeHead(206, {
        "Content-Type": "application/zip",
        "Content-Range": `bytes ${from}-${to}/${body.length}`,
        "Content-Length": to - from + 1,
        "Accept-Ranges": "bytes",
      });
      res.end(req.method === "HEAD" ? undefined : body.subarray(from, to + 1));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": body.length, "Accept-Ranges": "bytes" });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test-Server ohne Port");
  const origin = `http://127.0.0.1:${address.port}`;

  const key = createTestKey();
  const base = JSON.parse(readFileSync(join(REPO, "catalog", "catalog.json"), "utf8")) as {
    sequence: number;
    generatedAt: string;
    expiresAt: string;
    programs: { id: string; releases: unknown[] }[];
  };
  const now = Date.now();
  base.sequence = 1000;
  base.generatedAt = new Date(now - 3 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  base.expiresAt = new Date(now + (opts.expiresInDays ?? 60) * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const addRelease = (id: string, version: string, zip: Buffer, fileName: string, exeName: string) => {
    const program = base.programs.find((p) => p.id === id);
    if (!program) throw new Error(`Programm ${id} fehlt im Katalog`);
    program.releases.unshift({
      version,
      channel: "stable",
      releasedAt: "2026-10-17",
      artifacts: [
        {
          os: "windows",
          arch: "x86_64",
          kind: "zip",
          url: `${origin}/${fileName}`,
          fileName,
          size: zip.length,
          sha256: sha256(zip),
          checksumSource: `${origin}/${fileName}.sha256`,
          stripComponents: 1,
          unpackedSizeMax: 10_000_000,
          launch: { exe: `bin/${exeName}.exe`, fileArgs: "append" },
        },
      ],
    });
  };
  addRelease("krita", FIXTURE_VERSION.krita, krita.zip, "krita-fixture.zip", "krita");
  addRelease("inkscape", FIXTURE_VERSION.inkscape, inkscape.zip, "inkscape-fixture.zip", "inkscape");
  const json = `${JSON.stringify(base, null, 2)}\n`;
  const signature = key.signFile(Buffer.from(json));

  return {
    origin,
    hits,
    catalog: { json, signature },
    key,
    kritaSha256: sha256(krita.zip),
    kritaExeSha256: sha256(krita.exe),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
