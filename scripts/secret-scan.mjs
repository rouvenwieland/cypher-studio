#!/usr/bin/env node
// Sucht in den verfolgten Dateien (und mit --history in allen Revisionen) nach privaten Schlüsseln und Zugangsdaten.
// Kein Ersatz für ein vollständiges Werkzeug wie gitleaks, aber ohne Installation und mit den Formaten dieses Projekts
// (Tauri/minisign-Schlüssel, Passwortdateien). Läuft in der CI; lokal als Pre-Commit-Hook nutzbar:
//   echo 'node scripts/secret-scan.mjs --staged' > .git/hooks/pre-commit
//
//   node scripts/secret-scan.mjs              alle verfolgten und neuen, nicht ignorierten Dateien
//   node scripts/secret-scan.mjs --staged     nur die vorgemerkten Änderungen (Pre-Commit)
//   node scripts/secret-scan.mjs --history    zusätzlich alle bisherigen Änderungen (git log -p --all)
//
// Endet mit Code 1 bei einem Fund. Die Funde nennen Datei, Zeile und Art, nie den Wert.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Die Muster stehen in Stücken, damit dieses Skript sich nicht selbst trifft.
const PEM = "-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----";
// Tauri-Schlüsseldatei als Base64: die Kopfzeile "untrusted comment: minisign encrypted secret key" und danach der Schlüssel
const B64_TAURI_SECRET = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIGVuY3J5" + "cHRlZCBzZWNyZXQga2V5" + "[A-Za-z0-9+/=]{20,}";

/** Muster: `re` trifft eine Zeile oder (mit `multiline`) den Text. */
export const RULES = [
  { id: "pem-private-key", re: new RegExp(`${PEM}\\s*[A-Za-z0-9+/=]{16,}`), multiline: true, what: "privater PEM-/PGP-Schlüssel" },
  {
    id: "minisign-secret-key",
    // Eine Signaturdatei trägt "signature from … secret key" als Kommentar und ist kein Schlüssel
    re: new RegExp("untrusted comment:(?! signature)[^\n]*secret key[^\n]*\r?\n[A-Za-z0-9+/=]{40,}"),
    multiline: true,
    what: "geheimer minisign-Schlüssel",
  },
  { id: "tauri-secret-key-base64", re: new RegExp(B64_TAURI_SECRET), what: "geheimer Tauri-Schlüssel (Base64)" },
  {
    id: "signing-password-env",
    // TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)=Wert (Shell, .env); Verweise ($VAR, $(…), Platzhalter) sind in Ordnung
    re: /TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?\s*=\s*['"]?(?![\s'"$]|\{\{|<|\.\.\.|…|xxx)[A-Za-z0-9+/=_-]{8,}/i,
    what: "fester Wert für den Signierschlüssel oder sein Passwort",
  },
  {
    id: "signing-password-yaml",
    // TAURI_SIGNING_PRIVATE_KEY(_PASSWORD): Wert (YAML/JSON): in Anführungszeichen oder als ganzer Rest der Zeile
    re: /TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?['"]?\s*:\s*(['"][^'"$\s{<]{8,}['"]|(?![$'"{<])[A-Za-z0-9+/=_-]{8,}\s*$)/i,
    what: "fester Wert für den Signierschlüssel oder sein Passwort",
  },
  { id: "github-token", re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/, what: "GitHub-Token" },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/, what: "AWS-Zugangskennung" },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, what: "API-Schlüssel (Anthropic)" },
  { id: "cloudflare-token", re: /\bCLOUDFLARE_API_TOKEN\s*[:=]\s*['"]?(?![\s'"$]|\{\{)[A-Za-z0-9_-]{20,}/i, what: "Cloudflare-Token" },
];

/** Dateinamen, die nie eingecheckt werden sollen. */
export const FORBIDDEN_NAMES = [/\.key$/i, /\.minisign$/i, /\.sec$/i, /PASSWORT/i, /(^|\/)\.env(\.|$)(?!example)/];

/** Findet Treffer in `text`; gibt `{ rule, line }` zurück (Zeile ab 1). */
export function scanText(text, rules = RULES) {
  const hits = [];
  for (const rule of rules) {
    if (rule.multiline) {
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
      for (const m of text.matchAll(re)) hits.push({ rule, line: text.slice(0, m.index).split("\n").length });
    } else {
      text.split("\n").forEach((l, i) => {
        if (l.length < 4000 && rule.re.test(l)) hits.push({ rule, line: i + 1 });
      });
    }
  }
  return hits;
}

export function forbiddenName(path) {
  return FORBIDDEN_NAMES.some((re) => re.test(path.replaceAll("\\", "/")));
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr?.toString() ?? ""}`);
  return r.stdout;
}

const BINARY = /\.(png|jpe?g|webp|gif|ico|icns|ttf|otf|woff2?|zip|gz|xz|7z|blend|kra|glb|bundle|pdf|mp4|webm|wasm)$/i;

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const staged = process.argv.includes("--staged");
  const history = process.argv.includes("--history");
  const files = git(staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"] : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const problems = [];
  for (const file of files) {
    if (forbiddenName(file) && basename(file) !== ".env.example") problems.push(`${file}: Dateiname gehört nicht ins Repository`);
    if (BINARY.test(file)) continue;
    let text;
    try {
      text = staged ? git(["show", `:${file}`], root).toString("utf8") : readFileSync(resolve(root, file), "utf8");
    } catch {
      continue;
    }
    for (const hit of scanText(text)) problems.push(`${file}:${hit.line}: ${hit.rule.what} (${hit.rule.id})`);
  }
  if (history) {
    const patch = git(["log", "--all", "-p", "--no-color", "-U0"], root).toString("utf8");
    for (const hit of scanText(patch)) problems.push(`Verlauf (Zeile ${hit.line} der Ausgabe von git log -p): ${hit.rule.what} (${hit.rule.id})`);
    const names = git(["log", "--all", "--name-only", "--pretty=format:", "-z"], root).toString("utf8").split("\0").filter(Boolean);
    for (const name of new Set(names)) if (forbiddenName(name)) problems.push(`Verlauf: Datei ${name} wurde irgendwann eingecheckt`);
  }
  if (problems.length > 0) {
    console.error(`Geheimnisprüfung: ${problems.length} Fund(e)`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Geheimnisprüfung: ${files.length} Dateien${history ? " und der gesamte Verlauf" : ""} ohne Fund.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
