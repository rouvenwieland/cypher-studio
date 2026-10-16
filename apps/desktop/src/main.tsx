import "@tokens";
import "./styles/base.css";
import "./ui/ui.css";
import "./app/shell.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { applyCachedUi } from "./app/theme";

/**
 * Start: Im Browser ohne Tauri (Entwicklung, Playwright) ersetzt der Mock-Modus das IPC (ARCHITEKTUR 8.3).
 * Im Produktions-Build ohne VITE_MOCK_IPC wird dieser Zweig vollständig entfernt.
 */
async function boot(): Promise<void> {
  if (import.meta.env.DEV || import.meta.env.VITE_MOCK_IPC === "1") {
    if (!("__TAURI_INTERNALS__" in window)) {
      const { installMock } = await import("./ipc/mock");
      installMock();
      document.documentElement.setAttribute("data-mock", "1");
      console.info("Cypher Studio: Mock-Modus aktiv (Beispieldaten, keine echten Dateien).");
    }
  }
  applyCachedUi();
  const root = document.getElementById("root");
  if (!root) throw new Error("#root fehlt");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
