// release.json: Schema, Erzeugung aus GitHub-Release-Daten, Updater-JSON, Formatierung.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { classifyAsset, formatSize, hashGroups, hashShort, loadRelease, primaryFile, validateRelease, readJson } from '../../scripts/lib/release.mjs';
import { buildRelease, buildUpdaterJson } from '../../scripts/gen-release-json.mjs';
import { fixture, siteRoot } from '../helpers.mjs';

const none = { schemaVersion: 1, state: 'none' };
const file = (over = {}) => ({
  os: 'windows', arch: 'x86_64', kind: 'nsis', name: 'Cypher-Studio_0.4.0_x64-setup.exe',
  url: '/releases/Cypher-Studio_0.4.0_x64-setup.exe', size: 1000, sha256: 'a'.repeat(64), ...over,
});
const released = (over = {}) => ({ schemaVersion: 1, state: 'released', version: '0.4.0', date: '2026-11-02', files: [file()], ...over });

test('die ausgelieferte public/release.json ist gültig (Zustand A oder ein echtes Release mit SHA-256 je Datei)', () => {
  const r = loadRelease(join(siteRoot, 'public/release.json'));
  assert.ok(r.state === 'none' || r.state === 'released', r.state);
  if (r.state === 'released') {
    assert.ok(r.files.length > 0);
    for (const f of r.files) assert.match(f.sha256, /^[0-9a-f]{64}$/, f.name);
  }
});

test('Schema: Zustand A und B sind gültig', () => {
  assert.doesNotThrow(() => validateRelease(none));
  assert.doesNotThrow(() => validateRelease(released()));
});

const invalid = [
  ['Zustand A mit Dateien', { ...none, files: [file()] }],
  ['Zustand A mit Version', { ...none, version: '1.0.0' }],
  ['Zustand B ohne Dateien', { schemaVersion: 1, state: 'released', version: '0.4.0', date: '2026-11-02' }],
  ['Zustand B ohne Version', { schemaVersion: 1, state: 'released', date: '2026-11-02', files: [file()] }],
  ['falsche Schemaversion', { schemaVersion: 2, state: 'none' }],
  ['unbekannter Zustand', { schemaVersion: 1, state: 'beta' }],
  ['SHA-256 zu kurz', released({ files: [file({ sha256: 'abc' })] })],
  ['SHA-256 in Großbuchstaben', released({ files: [file({ sha256: 'A'.repeat(64) })] })],
  ['Leerzeichen im Dateinamen', released({ files: [file({ name: 'Cypher Studio.exe' })] })],
  ['http statt https', released({ files: [file({ url: 'http://example.org/a.exe' })] })],
  ['gehostete Datei über 24 MiB', released({ files: [file({ size: 30 * 1024 * 1024 })] })],
  ['unbekannte Art', released({ files: [file({ kind: 'msi' })] })],
  ['Datum falsch', released({ date: '02.11.2026' })],
  ['Version mit v', released({ version: 'v0.4.0' })],
  ['doppelter Eintrag', released({ files: [file(), file()] })],
  ['Dateiname ohne Version', released({ files: [file({ name: 'setup.exe' })] })],
  ['zusätzliches Feld', { ...none, foo: 1 }],
];
for (const [name, data] of invalid) {
  test(`Schema lehnt ab: ${name}`, () => assert.throws(() => validateRelease(data)));
}

test('große Datei darf auf https verlinken (kein Hosting auf der Seite)', () => {
  assert.doesNotThrow(() => validateRelease(released({
    files: [file({ url: 'https://github.com/x/y/releases/download/v0.4.0/Cypher-Studio_0.4.0_x64-setup.exe', size: 90 * 1024 * 1024 })],
  })));
});

test('Zuordnung der Release-Dateien', () => {
  assert.deepEqual(classifyAsset('Cypher-Studio_0.4.0_x64-setup.exe'), { os: 'windows', arch: 'x86_64', kind: 'nsis' });
  assert.deepEqual(classifyAsset('Cypher-Studio_0.4.0_universal.dmg'), { os: 'macos', arch: 'universal', kind: 'dmg' });
  assert.deepEqual(classifyAsset('Cypher-Studio_0.4.0_aarch64.dmg'), { os: 'macos', arch: 'aarch64', kind: 'dmg' });
  assert.deepEqual(classifyAsset('Cypher-Studio_0.4.0_x64.dmg'), { os: 'macos', arch: 'x86_64', kind: 'dmg' });
  assert.deepEqual(classifyAsset('Cypher-Studio_0.4.0_amd64.AppImage'), { os: 'linux', arch: 'x86_64', kind: 'appimage' });
  assert.deepEqual(classifyAsset('Cypher-Studio_0.4.0_amd64.deb'), { os: 'linux', arch: 'x86_64', kind: 'deb' });
  assert.deepEqual(classifyAsset('Cypher-Studio-0.4.0-1.x86_64.rpm'), { os: 'linux', arch: 'x86_64', kind: 'rpm' });
  for (const n of ['latest.json', 'Cypher-Studio_0.4.0_x64-setup.exe.sig', 'Cypher-Studio.app.tar.gz', 'x.msi', 'SHA256SUMS.txt']) {
    assert.equal(classifyAsset(n), null, n);
  }
});

test('gen-release-json: GitHub-Release wird zu release.json (Fixture)', () => {
  const gh = readJson(fixture('github-release.json'));
  const out = buildRelease(gh);
  assert.deepEqual(out, readJson(fixture('release-b.json')));
  assert.equal(out.files.length, 5);
  // AppImage ist größer als 24 MiB: Link auf GitHub, die anderen liegen auf der Seite
  const app = out.files.find((f) => f.kind === 'appimage');
  assert.match(app.url, /^https:\/\/github\.com\//);
  assert.ok(out.files.filter((f) => f.kind !== 'appimage').every((f) => f.url.startsWith('/releases/')));
});

test('gen-release-json: ohne Prüfsumme in der API und ohne Datei bricht es ab', () => {
  const gh = readJson(fixture('github-release.json'));
  gh.assets[0] = { ...gh.assets[0], digest: undefined };
  assert.throws(() => buildRelease(gh), /fehlt die SHA-256/);
});

test('gen-release-json: lokale Datei gewinnt, Größe und SHA-256 werden berechnet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-rel-'));
  try {
    const body = Buffer.from('FIXTURE-INSTALLER');
    writeFileSync(join(dir, 'Cypher-Studio_0.4.0_x64-setup.exe'), body);
    const gh = readJson(fixture('github-release.json'));
    const out = buildRelease(gh, { filesDir: dir });
    const win = out.files.find((f) => f.os === 'windows');
    assert.equal(win.size, body.length);
    assert.equal(win.sha256, createHash('sha256').update(body).digest('hex'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gen-release-json: Updater-JSON behält die Signaturen, URLs zeigen auf die Seite', () => {
  const up = buildUpdaterJson(readJson(fixture('tauri-latest.json')), 'https://studio.cypherxcypher.de');
  assert.equal(up.version, '0.4.0');
  assert.equal(up.platforms['windows-x86_64'].signature, 'FIXTURE-SIG-WINDOWS');
  assert.equal(up.platforms['windows-x86_64'].url, 'https://studio.cypherxcypher.de/releases/Cypher-Studio_0.4.0_x64-setup.exe');
  assert.deepEqual(up, readJson(fixture('updater-latest.json')));
});

test('gen-release-json: Kommandozeile schreibt Dateien und kopiert nur gehostete Installer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-cli-'));
  try {
    const filesDir = join(dir, 'assets');
    mkdirSync(filesDir);
    for (const n of ['Cypher-Studio_0.4.0_x64-setup.exe', 'Cypher-Studio_0.4.0_universal.dmg', 'Cypher-Studio_0.4.0_amd64.deb', 'Cypher-Studio-0.4.0-1.x86_64.rpm']) {
      writeFileSync(join(filesDir, n), `FIXTURE ${n}`);
    }
    const out = join(dir, 'release.json');
    const latest = join(dir, 'latest.json');
    const copyTo = join(dir, 'releases');
    execFileSync(process.execPath, [join(siteRoot, 'scripts/gen-release-json.mjs'),
      '--github-release', fixture('github-release.json'), '--tauri-latest', fixture('tauri-latest.json'),
      '--files-dir', filesDir, '--copy-to', copyTo, '--out', out, '--latest-out', latest], { encoding: 'utf8' });
    const r = loadRelease(out);
    assert.equal(r.state, 'released');
    assert.ok(existsSync(join(copyTo, 'Cypher-Studio_0.4.0_x64-setup.exe')));
    assert.ok(!existsSync(join(copyTo, 'Cypher-Studio_0.4.0_amd64.AppImage')), 'AppImage ist zu groß und wird nicht kopiert');
    assert.equal(readJson(latest).platforms['linux-x86_64'].signature, 'FIXTURE-SIG-LINUX');
    // --none schreibt Zustand A
    execFileSync(process.execPath, [join(siteRoot, 'scripts/gen-release-json.mjs'), '--none', '--out', out]);
    assert.deepEqual(readJson(out), { schemaVersion: 1, state: 'none' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Hilfen: Größe, Prüfsumme, Hauptdatei', () => {
  assert.equal(formatSize(10276044), '9,8 MB');
  assert.equal(formatSize(81788928), '78,0 MB');
  assert.equal(formatSize(200 * 1024 * 1024), '200 MB');
  assert.deepEqual(hashGroups('f18af273b6ea35cf'), ['f18a', 'f273', 'b6ea', '35cf']);
  assert.equal(hashShort('f18af273b6ea35cfc9a46398b99f9edc6f460b266a20f3c1fcc737f4fc51770f'), 'f18a f273 … fc51 770f');
  const b = readJson(fixture('release-b.json'));
  assert.equal(primaryFile(b, 'windows').kind, 'nsis');
  assert.equal(primaryFile(b, 'macos').arch, 'universal');
  assert.equal(primaryFile(b, 'linux').kind, 'appimage');
  assert.equal(primaryFile(none, 'windows'), null);
  // getrennte macOS-Builds: Apple Silicon vor Intel
  const split = {
    ...b,
    files: [
      file({ os: 'macos', arch: 'x86_64', kind: 'dmg', name: 'a_0.4.0_x64.dmg', url: '/releases/a_0.4.0_x64.dmg' }),
      file({ os: 'macos', arch: 'aarch64', kind: 'dmg', name: 'a_0.4.0_aarch64.dmg', url: '/releases/a_0.4.0_aarch64.dmg' }),
    ],
  };
  assert.equal(primaryFile(split, 'macos').arch, 'aarch64');
});

test('gen-release-json: Updater-JSON übersetzt Asset-IDs von tauri-action v1, große Dateien behalten den GitHub-Link', () => {
  const big = 30 * 1024 * 1024;
  const gh = [
    { id: 11, name: 'Cypher.Studio_0.1.0_x64-setup.exe', size: 18_000_000, browser_download_url: 'https://github.com/o/r/releases/download/v0.1.0/Cypher.Studio_0.1.0_x64-setup.exe' },
    { id: 12, name: 'Cypher.Studio_0.1.0_universal.app.tar.gz', size: big, browser_download_url: 'https://github.com/o/r/releases/download/v0.1.0/Cypher.Studio_0.1.0_universal.app.tar.gz' },
  ];
  const tauri = {
    version: '0.1.0',
    pub_date: '2026-10-18T00:00:00Z',
    platforms: {
      'windows-x86_64': { signature: 'S-WIN', url: 'https://api.github.com/repos/o/r/releases/assets/11' },
      'darwin-aarch64': { signature: 'S-MAC', url: 'https://api.github.com/repos/o/r/releases/assets/12' },
    },
  };
  const up = buildUpdaterJson(tauri, 'https://studio.cypherxcypher.de', '/releases/', gh);
  assert.equal(up.platforms['windows-x86_64'].url, 'https://studio.cypherxcypher.de/releases/Cypher.Studio_0.1.0_x64-setup.exe');
  assert.equal(up.platforms['darwin-aarch64'].url, gh[1].browser_download_url);
  assert.equal(up.platforms['darwin-aarch64'].signature, 'S-MAC');
  assert.throws(() => buildUpdaterJson({ ...tauri, platforms: { x: { signature: 's', url: 'https://api.github.com/repos/o/r/releases/assets/99' } } }, 'https://s', '/releases/', gh), /Asset 99/);
});
