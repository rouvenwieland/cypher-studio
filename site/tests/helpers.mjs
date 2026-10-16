// Gemeinsame Testhilfen: User-Agents, Release-Fixtures.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const siteRoot = fileURLToPath(new URL('../', import.meta.url));
export const fixture = (name) => join(siteRoot, 'tests/fixtures', name);

// Echte, gängige User-Agent-Zeichenfolgen (Oktober 2026, Chrome 140 / Safari 19 / Firefox 140)
export const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 16093.57.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

// Playwright überschreibt nur den User-Agent-String, nicht navigator.userAgentData (das bleibt das des echten Browsers).
// Damit der Test dem entspricht, was echte Browser melden, setzen wir beides passend:
// Chromium-Browser liefern userAgentData, Safari und Firefox nicht.
const CH = {
  windows: { platform: 'Windows', mobile: false },
  linux: { platform: 'Linux', mobile: false },
  android: { platform: 'Android', mobile: true },
  chromeos: { platform: 'Chrome OS', mobile: false },
};
const TOUCH = { android: 5, ios: 5, ipad: 5 };

export async function applyUa(context, key) {
  const ch = CH[key] ?? null;
  const touch = TOUCH[key] ?? 0;
  await context.addInitScript(({ ch, touch }) => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: ch ? { ...ch, brands: [] } : undefined });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touch });
  }, { ch, touch });
}
