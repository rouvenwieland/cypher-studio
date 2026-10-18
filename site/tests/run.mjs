// Testlauf für die Seite: baut beide Zustände, startet zwei lokale Server (wrangler dev, ohne Konto),
// führt die Playwright-Tests aus und räumt auf.
//   Port 8788: Zustand A (tests/fixtures/release-a.json, "noch kein Release"; unabhängig vom echten public/release.json)
//   Port 38789: Zustand B (tests/fixtures/release-b.json, mit kleinen Fixture-Installern)
// Läuft schon etwas auf dem Port (z. B. "npm run dev"), wird es weiterverwendet.
// Aufruf: node tests/run.mjs [playwright-Argumente, z. B. -g Erkennung]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, siteRoot } from './helpers.mjs';
import { readJson } from '../scripts/lib/release.mjs';

const A = { port: 8788, dir: 'dist' };
const B = { port: 38789, dir: 'dist-b' };
// Leistungsmessung: eigener Server mit Brotli wie bei Cloudflare (wrangler dev komprimiert nicht)
const PA = { port: 38790, dir: 'dist' };
const PB = { port: 38791, dir: 'dist-b' };
const node = process.execPath;
const isWin = process.platform === 'win32';

function run(args, opts = {}) {
  const r = spawnSync(node, args, { cwd: siteRoot, stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function up(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/robots.txt`); return r.ok; } catch { return false; }
}

// 1. Bauen
run(['scripts/build.mjs', '--quiet', '--release', fixture('release-a.json')]);
run(['scripts/build.mjs', '--quiet', '--release', fixture('release-b.json'), '--out', B.dir]);
// kleine Fixture-Installer für den Download-Test (nur die auf der Seite gehosteten Dateien)
const rel = readJson(fixture('release-b.json'));
mkdirSync(join(siteRoot, B.dir, 'releases'), { recursive: true });
for (const f of rel.files.filter((x) => x.url.startsWith('/'))) writeFileSync(join(siteRoot, B.dir, f.url.slice(1)), `FIXTURE ${f.name}\n`);

// 2. Server
const children = [];
const started = new Set(); // Ports, die dieser Lauf selbst gestartet hat
async function serve({ port, dir }) {
  if (await up(port)) { console.log(`Server auf ${port} läuft schon, wird weiterverwendet`); return; }
  const args = ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--assets', dir, '--persist-to', `.wrangler/state-${port}`];
  const child = spawn(isWin ? 'npx.cmd' : 'npx', args, { cwd: siteRoot, stdio: 'ignore', shell: isWin });
  children.push(child);
  started.add(port);
  for (let i = 0; i < 120; i++) {
    if (await up(port)) { console.log(`Server auf ${port} bereit (${dir})`); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server auf Port ${port} kam nicht hoch`);
}
function stopAll() {
  for (const c of children) {
    if (isWin && c.pid) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  // wrangler startet workerd als eigenen Prozess, der den Eltern-Prozess überlebt: über den Port finden und beenden,
  // aber nur, wenn er aus diesem Projektordner stammt (andere Teams nutzen eigene Server)
  if (isWin) {
    for (const p of [A, B, PA, PB]) {
      if (!started.has(p.port)) continue;
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-NetTCPConnection -LocalPort ${p.port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $c = Get-CimInstance Win32_Process -Filter \"ProcessId=$($_.OwningProcess)\" -ErrorAction SilentlyContinue; if ($c -and $c.CommandLine -like '*cypher-studio*site*') { Stop-Process -Id $_.OwningProcess -Force } }`], { stdio: 'ignore' });
    }
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

await serve(A);
await serve(B);
for (const p of [PA, PB]) {
  if (await up(p.port)) continue;
  const child = spawn(node, ['scripts/serve.mjs', '--dir', p.dir, '--port', String(p.port)], { cwd: siteRoot, stdio: 'ignore' });
  children.push(child);
  started.add(p.port);
  for (let i = 0; i < 40 && !(await up(p.port)); i++) await new Promise((r) => setTimeout(r, 250));
}

// 3. Tests
const r = spawnSync(isWin ? 'npx.cmd' : 'npx', ['playwright', 'test', '-c', 'tests/playwright.config.mjs', ...process.argv.slice(2)], {
  cwd: siteRoot, stdio: 'inherit', shell: isWin,
  env: { ...process.env, BASE_A: `http://127.0.0.1:${A.port}`, BASE_B: `http://127.0.0.1:${B.port}`, PERF_A: `http://127.0.0.1:${PA.port}`, PERF_B: `http://127.0.0.1:${PB.port}` },
});
stopAll();
process.exit(r.status ?? 1);
