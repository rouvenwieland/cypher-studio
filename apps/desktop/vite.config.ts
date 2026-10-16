import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
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

export default defineConfig(() => ({
  plugins: [react(), tokensFonts()],
  resolve: {
    alias: {
      "@contract": path.join(docsDir, "ipc-contract.ts"),
      "@tokens": tokensFile,
      "@": path.resolve(here, "src"),
    },
  },
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
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    fs: { allow: [here, docsDir] },
    watch: { ignored: ["**/src-tauri/**", "**/dist-mock/**", "**/test-results/**"] },
  },
  preview: { port: 4173, strictPort: true },
}));
