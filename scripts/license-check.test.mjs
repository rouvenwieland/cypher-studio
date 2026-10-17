// Tests für scripts/license-check.mjs:  node --test "scripts/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SHIPPED_ALLOWED, TOOLING_ALLOWED, checkLock, checkProjects, evaluate } from "./license-check.mjs";

const lock = (packages) => ({ lockfileVersion: 3, packages: { "": { name: "x" }, ...packages } });

test("SPDX: einfache Lizenzen, OR, AND, Klammern, WITH", () => {
  assert.equal(evaluate("MIT", SHIPPED_ALLOWED), true);
  assert.equal(evaluate("GPL-3.0-only", SHIPPED_ALLOWED), false);
  assert.equal(evaluate("MIT OR GPL-3.0-only", SHIPPED_ALLOWED), true, "OR: eine erlaubte Seite genügt");
  assert.equal(evaluate("MIT AND GPL-3.0-only", SHIPPED_ALLOWED), false, "AND: alle müssen erlaubt sein");
  assert.equal(evaluate("(MIT OR Apache-2.0) AND ISC", SHIPPED_ALLOWED), true);
  assert.equal(evaluate("(GPL-2.0-only OR AGPL-3.0-only) AND MIT", SHIPPED_ALLOWED), false);
  assert.equal(evaluate("Apache-2.0 WITH LLVM-exception", SHIPPED_ALLOWED), true);
  assert.equal(evaluate("Apache-2.0 WITH Classpath-exception-2.0", SHIPPED_ALLOWED), false, "unbekannte Ausnahme");
  assert.equal(evaluate("MPL-2.0", SHIPPED_ALLOWED), false);
  assert.equal(evaluate("MPL-2.0", TOOLING_ALLOWED), true);
  assert.equal(evaluate("", SHIPPED_ALLOWED), false);
  assert.throws(() => evaluate("(MIT", SHIPPED_ALLOWED));
  assert.throws(() => evaluate("MIT OR", SHIPPED_ALLOWED));
});

test("ausgelieferte Pakete: nur die strenge Liste, Entwicklungswerkzeuge dürfen MPL-2.0 tragen", () => {
  const r = checkLock(
    "apps/desktop",
    lock({
      "node_modules/a": { license: "MIT" },
      "node_modules/b": { license: "MPL-2.0" },
      "node_modules/c": { license: "MPL-2.0", dev: true },
      "node_modules/d": { license: "GPL-3.0-only", dev: true },
      "node_modules/e": {},
      "node_modules/f": { license: "Apache-2.0 OR MIT" },
    }),
  );
  const ok = Object.fromEntries(r.map((x) => [x.path.replace("node_modules/", ""), x.ok]));
  assert.deepEqual(ok, { a: true, b: false, c: true, d: false, e: false, f: true });
});

test("GPL, LGPL und AGPL sind in ausgelieferten Paketen nie erlaubt, auch nicht über eine Ausnahme", () => {
  for (const license of ["GPL-3.0-or-later", "LGPL-3.0-or-later", "AGPL-3.0-only", "SSPL-1.0", "UNLICENSED"]) {
    const r = checkLock("site", lock({ "node_modules/@img/sharp-x": { license } }));
    assert.equal(r[0].ok, false, license);
  }
});

test("Ausnahmen gelten nur für das genannte Paket im genannten Projekt und nur für Werkzeuge", () => {
  const sharp = { license: "LGPL-3.0-or-later", dev: true, optional: true };
  assert.equal(checkLock("site", lock({ "node_modules/@img/sharp-libvips-linux-x64": sharp }))[0].ok, true);
  assert.equal(checkLock("apps/desktop", lock({ "node_modules/@img/sharp-libvips-linux-x64": sharp }))[0].ok, false);
  assert.equal(checkLock("site", lock({ "node_modules/anderes": sharp }))[0].ok, false);
  assert.equal(
    checkLock("site", lock({ "node_modules/@img/sharp-win32-x64": { license: "Apache-2.0 AND LGPL-3.0-or-later", dev: true } }))[0].ok,
    true,
  );
  assert.equal(checkLock("apps/desktop", lock({ "node_modules/svg-tags": { dev: true } }))[0].ok, true);
  assert.equal(checkLock("apps/desktop", lock({ "node_modules/svg-tags": {} }))[0].ok, false, "ausgeliefert: keine Ausnahme");
});

test("der echte Quellbaum besteht die Prüfung", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const bad = checkProjects(root).filter((r) => !r.ok);
  assert.deepEqual(bad, []);
});
