// Tests für scripts/secret-scan.mjs:  node --test "scripts/*.test.mjs"
// Die Beispielschlüssel entstehen erst im Test (Zusammensetzen), damit weder dieser Test noch der Scan sie als Fund melden.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { forbiddenName, scanText } from "./secret-scan.mjs";

const ids = (text) => scanText(text).map((h) => h.rule.id);
const b64 = (n) => "A".repeat(n);

test("erkennt PEM-Schlüssel, aber keine bloße Erwähnung", () => {
  const pem = ["-----BEGIN ", "OPENSSH PRIVATE KEY-----", "\n", b64(70), "\n-----END ", "OPENSSH PRIVATE KEY-----"].join("");
  assert.deepEqual(ids(pem), ["pem-private-key"]);
  assert.deepEqual(ids("In der Doku steht ein Block aus BEGIN PRIVATE KEY und END."), []);
  assert.deepEqual(ids("-----BEGIN PUBLIC KEY-----\n" + b64(70)), []);
});

test("erkennt geheime minisign- und Tauri-Schlüssel, nicht den öffentlichen", () => {
  const secret = ["untrusted comment: minisign encrypted ", "secret key", "\n", b64(120)].join("");
  assert.deepEqual(ids(secret), ["minisign-secret-key"]);
  const publicKey = "untrusted comment: minisign public key: 32BB3732FD2E6DB2\nRWSybS79Mje7Mps2hvHAkVMrEDJrfHSgN8vTDbK1j8/W5L8VpnkYIzkw\n";
  assert.deepEqual(ids(publicKey), []);
  // so steht der Schlüssel in der Tauri-Datei und in der Umgebungsvariable: die Datei als Base64
  const wrapped = Buffer.from(["untrusted comment: minisign encrypted ", "secret key", "\n", b64(60), "\n"].join("")).toString("base64");
  assert.deepEqual(ids(`TAURI_SIGNING_PRIVATE_KEY_VALUE=${wrapped}`), ["tauri-secret-key-base64"]);
  // die öffentliche Tauri-Datei (Base64 von „… public key: …“) aus tauri.conf.json ist kein Fund
  const pub = Buffer.from(publicKey).toString("base64");
  assert.deepEqual(ids(`"pubkey": "${pub}"`), []);
});

test("feste Passwörter für den Signierschlüssel sind Funde, Verweise auf Secrets und Platzhalter nicht", () => {
  const found = (s) => ids(s).some((id) => id.startsWith("signing-password"));
  // der Name entsteht erst hier, damit der Scan dieses Testes nicht selbst anschlägt
  const K = "TAURI_SIGNING_" + "PRIVATE_KEY_PASSWORD";
  assert.equal(found(`${K}=Geheim1234!x`), true);
  assert.equal(found(`export ${K}="abcdefgh12"`), true);
  assert.equal(found(`${K}: hunter2hunter2`), true);
  assert.equal(found(`{"${K}": "hunter2hunter2"}`), true);
  assert.equal(found(`env: { ...process.env, ${K}: password },`), false, "Code, kein Wert");
  assert.equal(found(`${K}: \${{ secrets.${K} }}`), false);
  assert.equal(found(`${K}="$(sed -n x)"`), false);
  assert.equal(found(`${K}=$PASSWORT`), false);
  assert.equal(found(`${K}=<Passwort>`), false);
  assert.equal(found(`export ${K}=… (aus dem Passwortmanager)`), false);
});

test("erkennt Tokens", () => {
  assert.deepEqual(ids("token = " + ["gh", "p_", "a".repeat(36)].join("")), ["github-token"]);
  assert.deepEqual(ids(["AK", "IA", "ABCDEFGHIJKLMNOP"].join("")), ["aws-key"]);
  assert.deepEqual(ids(["sk-", "ant-", "api03-", "x".repeat(30)].join("")), ["anthropic-key"]);
});

test("verbotene Dateinamen", () => {
  for (const name of ["updater.key", "keys/catalog.key", "PASSWORT-SICHERN.txt", "x/passwort.txt", "a.minisign", "b.sec", ".env", ".env.local"]) {
    assert.equal(forbiddenName(name), true, name);
  }
  for (const name of ["catalog/keys/catalog-2026a.pub", "catalog/catalog.json.minisig", ".env.example", "src/key.ts", "keyboard.png"]) {
    assert.equal(forbiddenName(name), false, name);
  }
});

test("der verfolgte Quellbaum hat keinen Fund", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = spawnSync(process.execPath, [resolve(root, "scripts", "secret-scan.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
