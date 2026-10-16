// Prüft GLB-Dateien mit dem offiziellen Khronos-glTF-Validator (npm-Paket `gltf-validator`).
// Aufruf: node validate_gltf.mjs <datei.glb> [...]   (Umgebung: GLTF_VALIDATOR_DIR = Ordner mit node_modules/gltf-validator)
// Exit-Code 1 bei Fehlern (numErrors > 0). Externe Bilder (uri) werden neben der GLB gelesen.
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = process.env.GLTF_VALIDATOR_DIR ?? join(process.env.HOME ?? ".", "tools", "gltf-validator");
const require = createRequire(join(dir, "package.json"));
const validator = require("gltf-validator");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Aufruf: node validate_gltf.mjs <datei.glb> [...]");
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const abs = resolve(file);
  const bytes = new Uint8Array(readFileSync(abs));
  const report = await validator.validateBytes(bytes, {
    uri: abs,
    maxIssues: 100,
    externalResourceFunction: (uri) => {
      const p = join(dirname(abs), decodeURIComponent(uri));
      if (!existsSync(p)) return Promise.reject(new Error(`Datei fehlt: ${uri}`));
      return Promise.resolve(new Uint8Array(readFileSync(p)));
    },
  });
  const { numErrors, numWarnings, numInfos, numHints } = report.issues;
  console.log(`${file}: validator ${report.validatorVersion} · Fehler ${numErrors} · Warnungen ${numWarnings} · Infos ${numInfos} · Hinweise ${numHints}`);
  for (const m of report.issues.messages) {
    if (m.severity <= 2) console.log(`  [${["FEHLER", "WARNUNG", "INFO", "HINWEIS"][m.severity]}] ${m.code} ${m.pointer}: ${m.message}`);
  }
  if (numErrors > 0) failed++;
}
process.exit(failed > 0 ? 1 : 0);
