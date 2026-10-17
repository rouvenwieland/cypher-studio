/**
 * Startet die ECHTE App (Windows-Debug-Build mit `dev-tools`, WebView2) in einem Wegwerf-Datenordner und verbindet
 * Playwright über das Chrome-DevTools-Protokoll. Nichts davon berührt den echten Ordner
 * `%LOCALAPPDATA%\de.cypherxcypher.studio`: Daten, Einstellungen, Zwischenspeicher, Protokolle und das WebView2-Profil
 * liegen unter dem Wegwerf-Ordner.
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, type Fixtures } from "./fixtures";

const EXE_HINT =
  "Windows-Debug-Build fehlt. Bauen (PowerShell): wsl -d Ubuntu -- bash /mnt/c/Users/<du>/Code/cypher-studio/scripts/wsl-build.sh e2e";

export function appExe(): string {
  const exe = process.env["CYPHER_E2E_EXE"] ?? join(REPO, "dist-builds", "windows-e2e", "cypher-studio.exe");
  if (!existsSync(exe)) throw new Error(`${exe}\n${EXE_HINT}`);
  return exe;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() =>
        address && typeof address !== "string" ? resolve(address.port) : reject(new Error("kein Port")),
      );
    });
  });
}

/** Alles, was die Suite über die laufende App wissen und prüfen will. */
export interface Diagnostics {
  console: { type: string; text: string }[];
  pageErrors: string[];
  csp: string[];
  ipcErrors: { cmd: string; error: unknown }[];
  failedRequests: string[];
}

export interface LaunchOptions {
  /** Test-Katalog und Testschlüssel einrichten (dann auch Erkennung vom Rechner getrennt, http gegen 127.0.0.1) */
  fixtures?: Fixtures;
  /** Erkennung und Einrichtung vom echten Rechner trennen (`CYPHER_DEV_ISOLATE`); Vorgabe: an, wenn `fixtures` gesetzt ist */
  isolate?: boolean;
  /** Fenstergröße nach dem Start (CSS-Pixel) */
  viewport?: { width: number; height: number };
}

export interface RunningApp {
  page: Page;
  /** Wegwerf-Wurzel; darunter `data`, `config`, `cache`, `home`, `webview2`, `dialogs`, `out` */
  root: string;
  dataDir: string;
  outDir: string;
  diagnostics: Diagnostics;
  /** Antwort für den nächsten nativen Dialog (leer = Abbruch). Gilt für genau einen Dialog. */
  answerDialog(paths: string[]): void;
  /** IPC-Fehler seit dem letzten Abholen; sie landen auch in `diagnostics.ipcErrors` */
  takeIpcErrors(): Promise<{ cmd: string; error: unknown }[]>;
  stop(): Promise<void>;
}

/**
 * Läuft in der Seite vor allen eigenen Skripten: sammelt CSP-Verstöße; `__CYPHER_IPC_ERRORS__` ist der Prüfhaken in
 * `src/ipc/commands.ts` für abgelehnte IPC-Anfragen (Tauri macht `__TAURI_INTERNALS__.invoke` unveränderbar).
 */
const INIT = () => {
  const w = window as unknown as { __CYPHER_IPC_ERRORS__?: unknown[]; __csp?: string[] };
  w.__CYPHER_IPC_ERRORS__ = [];
  w.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    w.__csp?.push(`${e.violatedDirective} blockiert ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`);
  });
};

export async function launchApp(options: LaunchOptions = {}): Promise<RunningApp> {
  const exe = appExe();
  const base = process.env["CYPHER_E2E_TMP"] ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "cypher-e2e-real-"));
  const dialogs = join(root, "dialogs");
  for (const d of ["dialogs", "out", "webview2", "keys"]) mkdirSync(join(root, d), { recursive: true });
  const port = await freePort();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CYPHER_STUDIO_DATA_DIR: root,
    WEBVIEW2_USER_DATA_FOLDER: join(root, "webview2"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    CYPHER_DEV_DIALOGS: dialogs,
  };
  if (options.fixtures) {
    const keyFile = join(root, "keys", "test-catalog.pub");
    writeFileSync(keyFile, options.fixtures.key.publicKeyText);
    // Der signierte Test-Katalog liegt im Katalog-Zwischenspeicher der App und löst den eingebauten ab (höhere Folge)
    const cache = join(root, "data", "catalog");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "catalog.json"), options.fixtures.catalog.json);
    writeFileSync(join(cache, "catalog.json.minisig"), options.fixtures.catalog.signature);
    env["CYPHER_DEV_TRUST_KEY"] = keyFile;
    env["CYPHER_DEV_ALLOW_LOOPBACK_HTTP"] = "1";
  }
  if (options.isolate ?? Boolean(options.fixtures)) env["CYPHER_DEV_ISOLATE"] = "1";

  const child: ChildProcess = spawn(exe, [], { env, stdio: "ignore", windowsHide: false, detached: false });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  // Auf den Debug-Anschluss warten
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error("Die App hat sich beendet, bevor sie bereit war (Protokoll unter data/logs prüfen).");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) break;
    } catch {
      /* noch nicht bereit */
    }
    if (Date.now() > deadline) throw new Error("Debug-Anschluss der App nach 60 s nicht erreichbar.");
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Kein Browser-Kontext in der App.");
  let page = context.pages().find((p) => !p.url().startsWith("devtools"));
  for (let i = 0; !page && i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    page = context.pages().find((p) => !p.url().startsWith("devtools"));
  }
  if (!page) throw new Error("Kein App-Fenster gefunden.");
  const win = page;
  // Anfangs steht das Fenster auf about:blank und lädt noch: erst wenn die App-Adresse geladen ist, weitermachen
  for (let i = 0; i < 240 && !/^https?:\/\/tauri\.localhost\//.test(win.url()); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await win.waitForLoadState("domcontentloaded");

  const diagnostics: Diagnostics = { console: [], pageErrors: [], csp: [], ipcErrors: [], failedRequests: [] };
  win.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error" || m.type() === "warning") diagnostics.console.push({ type: m.type(), text: m.text() });
  });
  win.on("pageerror", (e) => diagnostics.pageErrors.push(String(e)));
  win.on("requestfailed", (r) => diagnostics.failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ""}`));
  await context.addInitScript(INIT);
  // Neu laden, damit Wächter und Init-Skript vom ersten Augenblick an dabei sind
  await win.reload();
  await win.waitForSelector('[data-testid^="screen-"], [data-testid="kennung"]', { timeout: 30_000 });
  await win.evaluate(() => document.fonts.ready);
  await win.waitForTimeout(800);
  // Meldungen aus dem ersten Laden und von unserem Neuladen („Couldn't find callback id“, abgebrochene IPC-Anfragen) zählen nicht
  diagnostics.console.length = 0;
  diagnostics.pageErrors.length = 0;
  diagnostics.failedRequests.length = 0;
  await win.evaluate(() => {
    (window as unknown as { __CYPHER_IPC_ERRORS__?: unknown[] }).__CYPHER_IPC_ERRORS__ = [];
  });
  if (options.viewport) await win.setViewportSize(options.viewport);

  const takeIpcErrors = async () => {
    const list = await win.evaluate(() => {
      const w = window as unknown as { __CYPHER_IPC_ERRORS__?: { cmd: string; error: unknown }[] };
      const out = w.__CYPHER_IPC_ERRORS__ ?? [];
      w.__CYPHER_IPC_ERRORS__ = [];
      return out;
    });
    diagnostics.ipcErrors.push(...list);
    return list;
  };

  return {
    page: win,
    root,
    dataDir: join(root, "data"),
    outDir: join(root, "out"),
    diagnostics,
    answerDialog(paths) {
      writeFileSync(join(dialogs, "next.json"), JSON.stringify(paths));
    },
    takeIpcErrors,
    async stop() {
      try {
        await takeIpcErrors();
        diagnostics.csp.push(
          ...(await win.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => [])),
        );
      } catch {
        /* Fenster schon zu */
      }
      await browser.close().catch(() => undefined);
      if (child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      // msedgewebview2-Prozesse hängen noch kurz an den Dateien: mit Wiederholung löschen
      for (let i = 0; i < 20; i++) {
        try {
          rmSync(root, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    },
  };
}
