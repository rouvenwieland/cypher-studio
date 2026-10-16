import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, "../../docs");
const tokensFile = path.join(docsDir, "tokens.css");
const host = process.env["TAURI_DEV_HOST"];

/**
 * docs/tokens.css ist die kanonische Quelle (Zone I) und verweist mit ./fonts/… auf Schriften neben der Datei.
 * Die Schriften liegen im App-Paket unter public/fonts: Die Pfade werden beim Laden umgeschrieben,
 * ohne die kanonische Datei zu verändern.
 */
function tokensFonts(): Plugin {
  return {
    name: "cypher-tokens-fonts",
    enforce: "pre",
    load(id) {
      const clean = id.split("?")[0] ?? id;
      if (path.normalize(clean) !== path.normalize(tokensFile)) return null;
      // Datei wird von Vite zusätzlich beobachtet
      this.addWatchFile(tokensFile);
      return null;
    },
    transform(code, id) {
      const clean = id.split("?")[0] ?? id;
      if (path.normalize(clean) !== path.normalize(tokensFile)) return null;
      return { code: code.replaceAll('url("./fonts/', 'url("/fonts/'), map: null };
    },
  };
}

/**
 * Produktions-CSP für den CSP-Test (ARCHITEKTUR 6.2, Prüfung 8): wörtlich aus src-tauri/tauri.conf.json (nur gelesen),
 * damit der Test dieselbe Richtlinie prüft wie die App. Einzige Abweichung: Der Mock-Build lädt seine Beispielbilder
 * von `blob:`-Adressen, deshalb darf `connect-src` dort zusätzlich `blob:` (die App selbst nutzt cyfile:/cyasset:).
 */
function productionCsp(): Record<string, string> | undefined {
  if (process.env["CYPHER_CSP_TEST"] !== "1") return undefined;
  const conf = JSON.parse(fs.readFileSync(path.join(here, "src-tauri/tauri.conf.json"), "utf8")) as {
    app: { security: { csp: Record<string, string> } };
  };
  const csp = { ...conf.app.security.csp };
  csp["connect-src"] = `${csp["connect-src"] ?? ""} blob:`.trim();
  return {
    "Content-Security-Policy": Object.entries(csp)
      .map(([k, v]) => `${k} ${v}`)
      .join("; "),
  };
}

const cspHeaders = productionCsp();

export default defineConfig(({ mode }) => ({
  plugins: [react(), tokensFonts()],
  resolve: {
    alias: {
      "@contract": path.join(docsDir, "ipc-contract.ts"),
      "@tokens": tokensFile,
      "@": path.resolve(here, "src"),
    },
  },
  // `vite build --mode mock` baut mit dem Mock-IPC (für den CSP-Test gegen den Produktions-Build)
  define: mode === "mock" ? { "import.meta.env.VITE_MOCK_IPC": JSON.stringify("1") } : {},
  clearScreen: false,
  build: {
    target: ["chrome110", "safari16", "edge110"],
    cssTarget: ["chrome110", "safari16"],
    sourcemap: false,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    ...(host ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    fs: { allow: [here, docsDir] },
    watch: { ignored: ["**/src-tauri/**", "**/dist-mock/**", "**/test-results/**"] },
  },
  preview: { port: 4173, strictPort: true, ...(cspHeaders ? { headers: cspHeaders } : {}) },
}));
