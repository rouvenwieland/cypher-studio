// Systemerkennung (src/js/boot.js): die ausgelieferte Datei läuft in einer VM mit nachgebautem navigator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { UA, siteRoot } from '../helpers.mjs';
import { join } from 'node:path';

const code = readFileSync(join(siteRoot, 'src/js/boot.js'), 'utf8');

function run(navigator) {
  const attrs = {};
  const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
  const window = {};
  vm.runInNewContext(code, { navigator, document, window });
  return { os: attrs['data-os'], api: window.cxDetectOs };
}

const cases = [
  ['Windows (Chrome, Client Hints)', { userAgent: UA.windows, userAgentData: { platform: 'Windows', mobile: false }, maxTouchPoints: 0 }, 'windows'],
  ['Windows mit Touchbildschirm', { userAgent: UA.windows, userAgentData: { platform: 'Windows', mobile: false }, maxTouchPoints: 10 }, 'windows'],
  ['Windows (nur User-Agent, z. B. Firefox)', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0' }, 'windows'],
  ['macOS (Safari)', { userAgent: UA.macos, maxTouchPoints: 0 }, 'macos'],
  ['macOS (Chrome, Client Hints)', { userAgent: UA.macos, userAgentData: { platform: 'macOS', mobile: false }, maxTouchPoints: 0 }, 'macos'],
  ['iPadOS meldet sich als Mac, hat Touch', { userAgent: UA.ipad, maxTouchPoints: 5 }, 'ios'],
  ['iPhone', { userAgent: UA.ios, maxTouchPoints: 5 }, 'ios'],
  ['Linux (Chrome)', { userAgent: UA.linux, userAgentData: { platform: 'Linux', mobile: false }, maxTouchPoints: 0 }, 'linux'],
  ['Linux (Firefox, Ubuntu)', { userAgent: UA.linuxFirefox }, 'linux'],
  ['Android enthält auch "Linux"', { userAgent: UA.android, userAgentData: { platform: 'Android', mobile: true }, maxTouchPoints: 5 }, 'android'],
  ['Android nur per Client Hints', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140', userAgentData: { platform: 'Android', mobile: true } }, 'android'],
  ['ChromeOS ist kein unterstütztes System', { userAgent: UA.chromeos, userAgentData: { platform: 'Chrome OS', mobile: false } }, 'other'],
  ['unbekannter Browser', { userAgent: 'curl/8.0' }, 'other'],
  ['leeres navigator-Objekt', {}, 'other'],
];

for (const [name, nav, expected] of cases) {
  test(`Erkennung: ${name} → ${expected}`, () => {
    assert.equal(run(nav).os, expected);
  });
}

test('boot.js wirft nie, auch wenn navigator kaputt ist', () => {
  const attrs = {};
  const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
  const navigator = new Proxy({}, { get() { throw new Error('kaputt'); } });
  vm.runInNewContext(code, { navigator, document, window: {} });
  assert.equal(attrs['data-os'], 'other');
});
