// Erzeugt site/public/release.json (und optional public/releases/latest.json für den App-Updater)
// aus den Daten eines GitHub-Releases. Läuft später in site.yml (ARCHITEKTUR 5.7), lokal mit Fixtures testbar.
//
// Aufrufe:
//   node scripts/gen-release-json.mjs --none
//       schreibt Zustand A ("noch kein Release")
//   node scripts/gen-release-json.mjs --github-release release.json [--tauri-latest latest.json]
//        [--files-dir ./assets] [--copy-to public/releases] [--site-base /releases/]
//        [--signed-windows] [--signed-macos] [--out public/release.json] [--latest-out public/releases/latest.json]
//
// --github-release   Antwort von `gh api repos/<org>/cypher-studio/releases/tags/v<version>` (JSON-Datei)
// --tauri-latest     latest.json von tauri-action; wird mit Seiten-URLs (gleiche Signaturen) neu geschrieben
// --files-dir        Ordner mit den heruntergeladenen Release-Dateien (für Größe und SHA-256, falls die API
//                    kein "digest" liefert; bei vorhandener Datei gewinnt die berechnete Prüfsumme)
// --copy-to          kopiert die ausgewählten Installer dorthin (Grenze 24 MiB je Datei)
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_FILE_BYTES, classifyAsset, readJson, validateRelease } from './lib/release.mjs';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const config = readJson(join(siteRoot, 'site.config.json'));

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/** Reine Funktion: GitHub-Release (+ optional lokale Dateien) → release.json-Objekt. Wirft bei Lücken. */
export function buildRelease(gh, opts = {}) {
  const { filesDir, siteBase = '/releases/', signedWindows = false, signedMacos = false } = opts;
  const version = String(gh.tag_name ?? '').replace(/^v/, '');
  const files = [];
  for (const asset of gh.assets ?? []) {
    const cls = classifyAsset(asset.name);
    if (!cls) continue;
    const local = filesDir && existsSync(join(filesDir, asset.name)) ? join(filesDir, asset.name) : null;
    let size = asset.size;
    let sha256 = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : null;
    if (local) {
      size = statSync(local).size;
      sha256 = sha256File(local);
    }
    if (!sha256) throw new Error(`Für ${asset.name} fehlt die SHA-256 (weder digest in der API noch Datei in --files-dir).`);
    // Bis 24 MiB liegt die Datei auf der Seite (/releases/…); größere kann Workers Static Assets nicht ausliefern
    // (ARCHITEKTUR R18) und verlinken direkt auf den GitHub-Release (öffentliches Repo nötig).
    let url = `${siteBase}${asset.name}`;
    if (size > MAX_FILE_BYTES) {
      if (!/^https:\/\//.test(asset.browser_download_url ?? '')) throw new Error(`${asset.name} ist größer als 24 MiB und hat keine browser_download_url.`);
      url = asset.browser_download_url;
    }
    files.push({ ...cls, name: asset.name, url, size, sha256 });
  }
  files.sort((a, b) => a.os.localeCompare(b.os) || a.kind.localeCompare(b.kind) || a.arch.localeCompare(b.arch));
  const release = {
    schemaVersion: 1,
    state: 'released',
    version,
    date: String(gh.published_at ?? gh.created_at ?? '').slice(0, 10),
    releaseUrl: gh.html_url ?? null,
    notes: null,
    signed: { windows: signedWindows, macos: signedMacos },
    files,
  };
  return validateRelease(release, 'erzeugtes release.json');
}

/** latest.json von tauri-action → gleiche Signaturen, URLs auf die Seite. */
export function buildUpdaterJson(tauri, siteOrigin, siteBase = '/releases/') {
  const out = { version: tauri.version, notes: tauri.notes ?? '', pub_date: tauri.pub_date, platforms: {} };
  for (const [key, p] of Object.entries(tauri.platforms ?? {})) {
    const name = decodeURIComponent(basename(new URL(p.url).pathname)).replaceAll(' ', '.');
    out.platforms[key] = { signature: p.signature, url: `${siteOrigin}${siteBase}${name}` };
  }
  return out;
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      none: { type: 'boolean' },
      'github-release': { type: 'string' },
      'tauri-latest': { type: 'string' },
      'files-dir': { type: 'string' },
      'copy-to': { type: 'string' },
      'site-base': { type: 'string', default: '/releases/' },
      'signed-windows': { type: 'boolean' },
      'signed-macos': { type: 'boolean' },
      out: { type: 'string', default: join(siteRoot, 'public/release.json') },
      'latest-out': { type: 'string', default: join(siteRoot, 'public/releases/latest.json') },
    },
  });
  if (v.none) {
    write(resolve(v.out), validateRelease({ schemaVersion: 1, state: 'none' }));
    console.log(`Zustand A (noch kein Release) → ${v.out}`);
    return;
  }
  if (!v['github-release']) {
    console.error('Aufruf: gen-release-json.mjs --none | --github-release <datei> [Optionen] (Kopf der Datei)');
    process.exit(2);
  }
  const release = buildRelease(readJson(v['github-release']), {
    filesDir: v['files-dir'], siteBase: v['site-base'], signedWindows: v['signed-windows'], signedMacos: v['signed-macos'],
  });
  write(resolve(v.out), release);
  console.log(`Zustand B (${release.version}, ${release.files.length} Dateien) → ${v.out}`);
  if (v['copy-to']) {
    if (!v['files-dir']) throw new Error('--copy-to braucht --files-dir');
    mkdirSync(v['copy-to'], { recursive: true });
    const hosted = release.files.filter((f) => f.url.startsWith('/'));
    for (const f of hosted) copyFileSync(join(v['files-dir'], f.name), join(v['copy-to'], f.name));
    console.log(`${hosted.length} Dateien kopiert nach ${v['copy-to']} (${release.files.length - hosted.length} größer als 24 MiB: Link auf GitHub)`);
  }
  if (v['tauri-latest']) {
    const updater = buildUpdaterJson(readJson(v['tauri-latest']), config.siteUrl, v['site-base']);
    write(resolve(v['latest-out']), updater);
    console.log(`Updater-JSON (${Object.keys(updater.platforms).length} Plattformen) → ${v['latest-out']}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(`FEHLER: ${e.message}`); process.exit(1); });
}
