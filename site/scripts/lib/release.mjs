// Gemeinsame Hilfen für Build, Release-Skript und Tests: release.json laden und prüfen,
// Dateien dem System zuordnen, Größen und Prüfsummen für Menschen formatieren.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const siteRoot = fileURLToPath(new URL('../../', import.meta.url));
export const MAX_FILE_BYTES = 24 * 1024 * 1024; // CI-Grenze, Workers Static Assets: 25 MiB je Datei (ARCHITEKTUR R18)

const schema = JSON.parse(readFileSync(new URL('../../release.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validate = ajv.compile(schema);

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Prüft ein release-Objekt gegen release.schema.json und zusätzliche Regeln. Wirft bei Fehlern. */
export function validateRelease(data, label = 'release.json') {
  if (!validate(data)) {
    const msg = validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new Error(`${label} ist ungültig: ${msg}`);
  }
  if (data.state === 'released') {
    const seen = new Set();
    for (const f of data.files) {
      const key = `${f.os}/${f.arch}/${f.kind}`;
      if (seen.has(key)) throw new Error(`${label}: doppelter Eintrag ${key}`);
      seen.add(key);
      if (!f.name.includes(data.version)) throw new Error(`${label}: Dateiname ${f.name} enthält die Version ${data.version} nicht`);
    }
  }
  return data;
}

export function loadRelease(path) {
  return validateRelease(readJson(path), path);
}

/** Ordnet einen Release-Dateinamen (tauri-action, GitHub) Betriebssystem, Architektur und Art zu. */
export function classifyAsset(name) {
  const n = name.toLowerCase();
  if (/\.(sig|json|txt|tar\.gz|zip|msi|sha256|minisig)$/.test(n)) return null;
  if (n.endsWith('-setup.exe')) return { os: 'windows', arch: 'x86_64', kind: 'nsis' };
  if (n.endsWith('.dmg')) {
    const arch = /aarch64|arm64/.test(n) ? 'aarch64' : /x64|x86_64|intel/.test(n) ? 'x86_64' : 'universal';
    return { os: 'macos', arch, kind: 'dmg' };
  }
  if (n.endsWith('.appimage')) return { os: 'linux', arch: 'x86_64', kind: 'appimage' };
  if (n.endsWith('.deb')) return { os: 'linux', arch: 'x86_64', kind: 'deb' };
  if (n.endsWith('.rpm')) return { os: 'linux', arch: 'x86_64', kind: 'rpm' };
  return null;
}

export const OS_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
export const KIND_LABEL = {
  nsis: 'Setup (.exe)',
  dmg: 'Disk-Image (.dmg)',
  appimage: 'AppImage',
  deb: '.deb-Paket',
  rpm: '.rpm-Paket',
};

/** Bevorzugte Datei je System: Windows nsis, macOS universal vor aarch64 vor x86_64, Linux AppImage. */
export function primaryFile(release, os) {
  if (release.state !== 'released') return null;
  const pool = release.files.filter((f) => f.os === os);
  const prefer = { windows: ['nsis'], macos: ['dmg'], linux: ['appimage', 'deb', 'rpm'] }[os];
  for (const kind of prefer) {
    const cand = pool.filter((f) => f.kind === kind);
    const order = ['universal', 'aarch64', 'x86_64'];
    cand.sort((a, b) => order.indexOf(a.arch) - order.indexOf(b.arch));
    if (cand[0]) return cand[0];
  }
  return null;
}

export function filesFor(release, os) {
  if (release.state !== 'released') return [];
  return release.files.filter((f) => f.os === os);
}

/** 9738240 → "9,3 MB" (1 MB = 1024 × 1024 Byte, wie im Datei-Explorer). */
export function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  const digits = mb >= 100 ? 0 : 1;
  return `${mb.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} MB`;
}

/** 64 Hex-Zeichen → ['9f3a', '1c0e', …] (16 Vierergruppen). */
export function hashGroups(hex) {
  return hex.match(/.{4}/g) ?? [];
}

/** Kurzform für die Messzeile: "9f3a 1c0e … 77b2 d4e1". */
export function hashShort(hex) {
  const g = hashGroups(hex);
  return `${g.slice(0, 2).join(' ')} … ${g.slice(-2).join(' ')}`;
}

export function datumDe(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export { siteRoot };
