// Signiert catalog/catalog.json mit dem Katalog-Schlüssel (minisign, passwortgeschützt, erzeugt mit `tauri signer generate`)
// und schreibt catalog/catalog.json.minisig im minisign-Textformat, das die App prüft.
// Aufruf:
//   node scripts/sign-catalog.mjs --key C:\Users\<du>\.cypher-studio-keys\catalog.key [--password-file <datei>] [--file catalog/catalog.json]
// Passwort: aus --password-file (Zeile "Passwort: …" oder ganze Datei) oder Umgebungsvariable CYPHER_CATALOG_KEY_PASSWORD.
// Das Passwort geht an den Signierer über die Umgebung seines Prozesses (TAURI_SIGNING_PRIVATE_KEY_PASSWORD), nie als
// Kommandozeilenargument: Argumente sind für andere Prozesse desselben Benutzers sichtbar (Sicherheitsreview M4).
// Nie in CI ausführen; der Katalog-Schlüssel bleibt beim Katalog-Verantwortlichen.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const key = arg("--key");
const file = resolve(arg("--file") ?? join(root, "catalog", "catalog.json"));
if (!key || !existsSync(key)) { console.error("Bitte --key <pfad zu catalog.key> angeben."); process.exit(2); }

let password = process.env.CYPHER_CATALOG_KEY_PASSWORD;
const pwFile = arg("--password-file");
if (pwFile) {
  const text = readFileSync(pwFile, "utf8");
  password = (text.match(/^Passwort:\s*(\S+)\s*$/m)?.[1] ?? text).trim();
}
if (!password) { console.error("Kein Passwort: --password-file oder CYPHER_CATALOG_KEY_PASSWORD setzen."); process.exit(2); }

// Plausibilität: gültiges JSON, Sequenz zum Mitschreiben
const catalog = JSON.parse(readFileSync(file, "utf8"));
const cli = join(root, "apps", "desktop", "node_modules", "@tauri-apps", "cli", "tauri.js");
execFileSync(process.execPath, [cli, "signer", "sign", "-f", key, file], {
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password },
});
const sigB64 = readFileSync(`${file}.sig`, "utf8").trim();
rmSync(`${file}.sig`);
const minisig = Buffer.from(sigB64, "base64").toString("utf8");
if (!minisig.startsWith("untrusted comment:")) { console.error("Unerwartetes Signaturformat."); process.exit(1); }
writeFileSync(`${file}.minisig`, minisig.endsWith("\n") ? minisig : `${minisig}\n`);
console.log(`Signiert: ${file} (Sequenz ${catalog.sequence ?? "?"}) → ${file}.minisig`);
