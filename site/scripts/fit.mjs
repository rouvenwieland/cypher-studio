// Misst die Laufweite (in em) der Display-Wörter in Anybody je Breitenachse (wdth).
// Ergebnis steht als --e-Werte in src/css/site.css: font-size = 100cqi / e, und im Objekt FIT in src/js/site.js.
// Aufruf: node scripts/fit.mjs [wght] [tracking-em]   (Desktop-Schnitt: 800 -0.02)
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const font = 'data:font/woff2;base64,' + readFileSync(join(root, 'public/fonts/anybody.woff2')).toString('base64');
const wght = Number(process.argv[2] || 800);
const track = Number(process.argv[3] ?? -0.02);
const words = ['CYPHER', 'STUDIO', 'KRITA', 'INKSCAPE', 'BLENDER', 'KDENLIVE'];
const widths = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>@font-face{font-family:A;src:url(${font}) format('woff2');font-weight:100 900;font-stretch:50% 150%}
span{font-family:A;font-size:100px;white-space:nowrap;position:absolute;font-kerning:normal}</style><div id=r></div>`);
const out = await page.evaluate(async ({ words, widths, wght, track }) => {
  await document.fonts.load(`${wght} 100px A`);
  const r = document.getElementById('r');
  const res = {};
  for (const w of words) {
    res[w] = {};
    for (const s of widths) {
      const el = document.createElement('span');
      el.textContent = w;
      el.style.fontVariationSettings = `"wdth" ${s}, "wght" ${wght}`;
      el.style.letterSpacing = `${track}em`;
      r.append(el);
      // letzte Laufweite nach dem letzten Zeichen abziehen (sichtbare Breite)
      res[w][s] = +((el.getBoundingClientRect().width / 100) - track).toFixed(4);
      el.remove();
    }
  }
  // Versalhöhe relativ zur Schriftgröße
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${wght} 100px A`;
  const m = c.measureText('H');
  res._cap = +(m.actualBoundingBoxAscent / 100).toFixed(4);
  return res;
}, { words, widths, wght, track });
console.log(`wght ${wght}, tracking ${track}em, Versalhöhe ${out._cap} em`);
console.log(['Wort', ...widths].join('\t'));
for (const w of words) console.log([w, ...widths.map((s) => out[w][s])].join('\t'));
// Für die Skript-Tabelle: Laufweite bei wdth 50 und Zuwachs je wdth-Einheit
console.log('\nFIT = {');
for (const w of words) {
  const a = out[w][50]; const b = out[w][150];
  console.log(`  ${w.toLowerCase()}: [${a}, ${((b - a) / 100).toFixed(6)}],`);
}
console.log('}');
await browser.close();
