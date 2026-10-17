#!/usr/bin/env node
// Prüft die Lizenzen aller npm-Abhängigkeiten gegen eine Positivliste (ARCHITEKTUR 6.10, 8.7; Sicherheitsreview).
//
//   node scripts/license-check.mjs            prüft apps/desktop, site und packs/tools
//   node scripts/license-check.mjs --list     zusätzlich die Lizenzen je Paket
//
// Gelesen werden die Lockdateien (`package-lock.json`, Version 2 oder 3); es braucht kein `npm install`. Pakete, die in die
// App oder in ausgelieferte Dateien gelangen (kein `dev`), müssen eine Lizenz der strengen Liste haben. Entwicklungswerkzeuge
// (`dev`) dürfen zusätzlich schwach kopierleftierte Lizenzen tragen, weil sie nicht ausgeliefert werden. Ausnahmen stehen
// einzeln mit Begründung unten. Ein unbekanntes Paket ohne Lizenzangabe ist immer ein Fehler.
//
// Endet mit Code 1, wenn ein Paket nicht passt. Keine Abhängigkeiten außer Node.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Lizenzen, die in ausgelieferten Paketen erlaubt sind (permissiv). */
export const SHIPPED_ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "Zlib",
  "BlueOak-1.0.0",
]);

/** Zusätzlich für Entwicklungswerkzeuge: nicht ausgeliefert, daher dürfen auch diese Lizenzen vorkommen. */
export const TOOLING_ALLOWED = new Set([...SHIPPED_ALLOWED, "MPL-2.0", "CC-BY-4.0", "Python-2.0"]);

/** Erlaubte Ausnahme-Zusätze nach `WITH` (SPDX), zum Beispiel `Apache-2.0 WITH LLVM-exception`. */
export const ALLOWED_EXCEPTIONS = new Set(["LLVM-exception"]);

/**
 * Einzelne Ausnahmen: Pfad in der Lockdatei (Muster) in einem Projekt, erlaubte Lizenz und Begründung.
 * Jede Zeile braucht einen Grund; neue Ausnahmen gehören in eine Pull-Request-Beschreibung.
 */
export const EXCEPTIONS = [
  {
    project: "site",
    path: /^node_modules\/@img\/sharp-/,
    allow: ["LGPL-3.0-or-later"],
    reason:
      "libvips (LGPL) steckt in den vorgebauten sharp-Binärdateien von wrangler/miniflare. Es ist ein Entwicklungswerkzeug der " +
      "Seite (lokaler Server); die ausgelieferten Dateien enthalten es nicht.",
  },
  {
    project: "apps/desktop",
    path: /^node_modules\/svg-tags$/,
    allow: ["MIT"],
    reason: "Die Lockdatei nennt keine Lizenz; die LICENSE-Datei des Pakets ist MIT. Nur Stylelint (Entwicklung).",
  },
];

export const PROJECTS = ["apps/desktop", "site", "packs/tools"];

// ---------------------------------------------------------------------------------------------
// SPDX-Ausdrücke
// ---------------------------------------------------------------------------------------------

function tokenize(expr) {
  const tokens = expr.match(/\(|\)|[^\s()]+/g);
  return tokens ?? [];
}

/** Wertet einen SPDX-Ausdruck aus: `OR` genügt eine erlaubte Seite, `AND` müssen alle erlaubt sein. */
export function evaluate(expression, allowed) {
  const tokens = tokenize(String(expression));
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function orExpr() {
    let ok = andExpr();
    while (peek() === "OR") {
      next();
      const right = andExpr();
      ok = ok || right;
    }
    return ok;
  }
  function andExpr() {
    let ok = term();
    while (peek() === "AND") {
      next();
      const right = term();
      ok = ok && right;
    }
    return ok;
  }
  function term() {
    const t = next();
    if (t === undefined) throw new Error(`Unvollständiger Ausdruck: ${expression}`);
    if (t === "(") {
      const ok = orExpr();
      if (next() !== ")") throw new Error(`Klammer fehlt: ${expression}`);
      return ok;
    }
    let id = t.replace(/\+$/, "");
    let ok = allowed.has(id) || allowed.has(t);
    if (peek() === "WITH") {
      next();
      const exception = next();
      ok = ok && ALLOWED_EXCEPTIONS.has(exception);
      id = `${id} WITH ${exception}`;
    }
    return ok;
  }

  if (tokens.length === 0) return false;
  const result = orExpr();
  if (pos !== tokens.length) throw new Error(`Unerwartetes Zeichen in: ${expression}`);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Prüfung
// ---------------------------------------------------------------------------------------------

function licenseOf(entry) {
  if (typeof entry.license === "string") return entry.license;
  if (entry.license && typeof entry.license === "object" && typeof entry.license.type === "string") return entry.license.type;
  if (Array.isArray(entry.licenses)) return entry.licenses.map((l) => l.type ?? String(l)).join(" OR ");
  return undefined;
}

/** Prüft die Pakete einer Lockdatei. Gibt Einträge `{ project, path, license, scope, ok, note }` zurück. */
export function checkLock(project, lock) {
  const results = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === "" || entry.link) continue;
    const license = licenseOf(entry);
    const scope = entry.dev ? "tooling" : "shipped";
    const allowed = scope === "shipped" ? SHIPPED_ALLOWED : TOOLING_ALLOWED;
    let ok = false;
    let note = "";
    if (license !== undefined) {
      try {
        ok = evaluate(license, allowed);
      } catch (e) {
        note = e.message;
      }
    } else {
      note = "keine Lizenzangabe";
    }
    if (!ok) {
      // Eine Ausnahme erweitert die Positivliste nur für dieses Paket und nur für Entwicklungswerkzeuge. Fehlt die Angabe,
      // gilt die erste Lizenz der Ausnahme (Lockdatei ohne Lizenzfeld, Lizenz anderweitig geprüft).
      const exception = EXCEPTIONS.find((x) => x.project === project && x.path.test(path));
      if (exception && scope === "tooling") {
        try {
          ok = evaluate(license ?? exception.allow[0], new Set([...allowed, ...exception.allow]));
        } catch {
          ok = false;
        }
        if (ok) note = `Ausnahme: ${exception.reason}`;
      }
    }
    results.push({ project, path, name: entry.name ?? path.replace(/^.*node_modules\//, ""), license: license ?? "?", scope, ok, note });
  }
  return results;
}

export function checkProjects(root, projects = PROJECTS) {
  const all = [];
  for (const project of projects) {
    const file = join(root, project, "package-lock.json");
    if (!existsSync(file)) {
      all.push({ project, path: "package-lock.json", name: "package-lock.json", license: "?", scope: "-", ok: false, note: "Lockdatei fehlt" });
      continue;
    }
    all.push(...checkLock(project, JSON.parse(readFileSync(file, "utf8"))));
  }
  return all;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const list = process.argv.includes("--list");
  const results = checkProjects(root);
  const bad = results.filter((r) => !r.ok);
  const excepted = results.filter((r) => r.ok && r.note.startsWith("Ausnahme"));
  if (list) {
    for (const r of results) console.log(`${r.ok ? "ok  " : "FEHL"} ${r.project.padEnd(13)} ${r.scope.padEnd(8)} ${r.license.padEnd(40)} ${r.path}`);
  }
  const perProject = PROJECTS.map((p) => {
    const mine = results.filter((r) => r.project === p);
    return `${p}: ${mine.length} Pakete (${mine.filter((r) => r.scope === "shipped").length} ausgeliefert)`;
  });
  console.log(perProject.join("; "));
  if (excepted.length > 0) {
    const reasons = new Map();
    for (const r of excepted) reasons.set(r.note, (reasons.get(r.note) ?? 0) + 1);
    for (const [note, n] of reasons) console.log(`${n} Paket(e) mit ${note}`);
  }
  if (bad.length > 0) {
    console.error(`\n${bad.length} Paket(e) mit nicht erlaubter Lizenz:`);
    for (const r of bad) console.error(`  ${r.project}  ${r.path}  ${r.license}  (${r.scope})${r.note ? "  " + r.note : ""}`);
    console.error("\nErlaubt (ausgeliefert):", [...SHIPPED_ALLOWED].join(", "));
    console.error("Zusätzlich für Entwicklungswerkzeuge:", [...TOOLING_ALLOWED].filter((l) => !SHIPPED_ALLOWED.has(l)).join(", "));
    process.exit(1);
  }
  console.log("Lizenzen: alle Pakete auf der Positivliste.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
