// Startseite: Kennung + Download, Programme, Messspur-Szene, Aufbau, Installieren, Prüfen, Typenschild.
import { esc, footer, page } from './layout.mjs';
import { drawingSize } from './drawfile.mjs';
import { KIND_LABEL, OS_LABEL, datumDe, filesFor, formatSize, hashGroups, hashShort, primaryFile } from '../../scripts/lib/release.mjs';

const ARROW = '<svg class="dl-arrow" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M20 4v28M8 21l12 12 12-12"/></svg>';
const EXT = '<svg class="ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9l6-6M4 3h5v5"/></svg>';

const OS_META = {
  windows: { name: 'Windows', detail: '10 und 11 · 64 Bit · Setup (.exe)', cta: 'Cypher Studio für Windows laden' },
  macos: { name: 'macOS', detail: '13 oder neuer · Apple Silicon und Intel · Disk-Image (.dmg)', cta: 'Cypher Studio für macOS laden' },
  linux: { name: 'Linux', detail: '64 Bit · AppImage', cta: 'Cypher Studio für Linux laden' },
};

const relAttr = (url) => (/^https?:/.test(url) ? ' rel="noopener noreferrer"' : '');

function altLabel(f) {
  if (f.os === 'macos') return f.arch === 'aarch64' ? 'Apple Silicon (.dmg)' : f.arch === 'x86_64' ? 'Intel (.dmg)' : 'Universal (.dmg)';
  return KIND_LABEL[f.kind];
}

function dlRow(os, ctx) {
  const m = OS_META[os];
  const f = primaryFile(ctx.release, os);
  if (!f) {
    return `<li class="dl-row dl-row-soon" data-os="${os}"><p class="dl-soon"><span class="dl-os">${m.name}</span><span class="dl-fact">Datei folgt</span></p></li>`;
  }
  const alts = filesFor(ctx.release, os).filter((x) => x !== f);
  const label = `${m.cta}, Version ${ctx.release.version}, ${formatSize(f.size)}`;
  const detail = os === 'macos' && f.arch !== 'universal' ? `${m.detail.split(' · ')[0]} · ${altLabel(f)}` : m.detail;
  return `<li class="dl-row" data-os="${os}">
      <a class="dl-main" href="${esc(f.url)}" download${relAttr(f.url)} aria-label="${esc(label)}" data-dl="${os}">
        <span class="dl-os">${m.name}<span class="dl-os-d"> · ${esc(detail)}</span></span>
        <span class="dl-cta">${esc(m.cta)}</span>
        <span class="dl-fact"><span>${esc(ctx.release.version)}</span><span>${formatSize(f.size)}</span><span class="dl-sha">SHA-256 ${hashShort(f.sha256)}</span></span>
        ${ARROW}
      </a>${alts.length ? `
      <p class="dl-alt"><span class="dl-alt-l">Auch als</span> ${alts.map((a) => `<a href="${esc(a.url)}" download${relAttr(a.url)} data-dl="${os}">${esc(altLabel(a))}</a>`).join('<span class="dl-sep" aria-hidden="true"> · </span>')}</p>` : ''}
    </li>`;
}

function downloadBlock(ctx) {
  const { release } = ctx;
  const mobile = `<div class="dl-mobile" id="dl-mobile">
      <p class="dl-mobile-t">Cypher Studio läuft auf Windows, macOS und Linux.</p>
      <p class="dl-mobile-s">Es gibt Cypher Studio nur für Computer, nicht fürs Handy. Öffne diese Seite an deinem Rechner, dort lädst du es herunter.</p>
      <p class="dl-mobile-u"><span class="data" data-copy-src>${esc(ctx.config.siteUrl)}</span> <button type="button" class="btn-copy" data-copy-page hidden>Link kopieren</button></p>
    </div>`;
  if (release.state !== 'released') {
    return `<div class="getb dl-none" id="download" aria-labelledby="dl-h">
    <h2 class="sr" id="dl-h">Download</h2>
    <div class="dl-none-in">
      <p class="dl-none-t">Die erste Version erscheint in Kürze.</p>
      <p class="dl-fact"><span>Noch kein Download</span><span>Windows 10/11</span><span>macOS 13+</span><span>Linux x86_64</span></p>
      <p class="dl-none-a"><a href="/anleitung/">Die Anleitung „In 30 Minuten startklar“ steht schon bereit</a></p>
    </div>
    ${mobile}
  </div>`;
  }
  return `<div class="getb" id="download" aria-labelledby="dl-h">
    <h2 class="sr" id="dl-h">Download</h2>
    <ul class="dl-list">
      ${['windows', 'macos', 'linux'].map((os) => dlRow(os, ctx)).join('\n      ')}
    </ul>
    <p class="dl-more"><a href="#pruefen">Alle Dateien und Prüfsummen</a><span class="dl-sep" aria-hidden="true"> · </span><a href="#installieren">Warum Windows und macOS warnen</a>${release.releaseUrl ? `<span class="dl-sep" aria-hidden="true"> · </span><a href="${esc(release.releaseUrl)}" rel="noopener noreferrer">Release-Seite</a>` : ''}</p>
    ${mobile}
  </div>`;
}

// ── Programm-Stapel ──────────────────────────────────────────────

const PROGRAMS = [
  { id: 'krita', name: 'Krita', role: 'Malen · Foto', url: 'https://krita.org/', host: 'krita.org', quelle: 'download.kde.org', lizenz: 'GPL-3.0-or-later', setup: 'Palette „Cypher Kollektionen“, Dokumentvorlagen für Shirt, Hoodie, Post und Story, Schriften' },
  { id: 'inkscape', name: 'Inkscape', role: 'Vektor · Druck', url: 'https://inkscape.org/', host: 'inkscape.org', quelle: 'media.inkscape.org', lizenz: 'GPL-2.0-or-later', setup: 'Palette, Vorlagen mit der Druckfläche als Seite in Millimetern, Export mit 300 dpi' },
  { id: 'blender', name: 'Blender', role: '3D', url: 'https://www.blender.org/', host: 'blender.org', quelle: 'download.blender.org', lizenz: 'GPL-3.0-or-later', setup: 'Asset-Bibliothek „Cypher 3D“, Mockup-Szene, Add-on „Cypher Export“' },
  { id: 'kdenlive', name: 'Kdenlive', role: 'Video', url: 'https://kdenlive.org/', host: 'kdenlive.org', quelle: 'download.kde.org', lizenz: 'GPL-3.0 (KDE-Zusatz)', setup: 'Projektprofile 1080 × 1920 und 1080 × 1350 bei 30 fps, Titelvorlagen, Render-Profil „Reel“' },
];

function programme() {
  return `<section class="pg" id="programme" aria-labelledby="pg-h">
    <header class="pg-head">
      <h2 class="h2" id="pg-h">Vier Programme, geladen von der Quelle</h2>
      <p class="pg-intro">Cypher Studio bringt die Programme nicht selbst mit. Es lädt sie von den offiziellen Servern der Projekte, vergleicht die Prüfsumme und installiert nur, wenn sie stimmt. Die Programme bleiben unverändert.</p>
    </header>
    <ol class="pg-list">
      ${PROGRAMS.map((p) => `<li class="pg-row" data-p="${p.id}">
        <h3 class="pg-n"><a href="${p.url}" rel="noopener noreferrer"><span class="w w-${p.id}">${p.name}</span><span class="sr">, Projektseite ${p.host}</span></a></h3>
        <p class="pg-role lbl">${p.role}</p>
        <dl class="pg-d">
          <div><dt class="lbl">Quelle</dt><dd class="data">${p.quelle}</dd></div>
          <div><dt class="lbl">Lizenz</dt><dd class="data">${p.lizenz}</dd></div>
          <div class="pg-set"><dt class="lbl">Studio richtet ein</dt><dd>${esc(p.setup)}</dd></div>
        </dl>
        <span class="pg-go" aria-hidden="true">${EXT}</span>
      </li>`).join('\n      ')}
    </ol>
  </section>`;
}

// ── Messspur-Szene ───────────────────────────────────────────────

/** Rauschen-Motiv (eigenes Platzhalter-Schema): Kreis aus Zeilen mit unterschiedlicher Länge, deterministisch. */
function motif() {
  const cx = 165; const cy = 166; const r = 140;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let d = '';
  for (let y = cy - r + 2; y < cy + r - 2; y += 7) {
    const dy = Math.abs(y + 2 - cy);
    const half = Math.sqrt(r * r - dy * dy);
    const a = half * (0.55 + 0.45 * rnd());
    const b = half * (0.55 + 0.45 * rnd());
    d += `M${(cx - a).toFixed(1)} ${y}h${(a + b).toFixed(1)}v4h-${(a + b).toFixed(1)}z`;
  }
  return `<g class="m-motif">
      <path class="m-bars" d="${d}"/>
      <circle class="m-ring" cx="${cx}" cy="${cy}" r="${r}"/>
      <text class="m-word" x="25" y="338" textLength="280" lengthAdjust="spacingAndGlyphs">RAUSCHEN</text>
    </g>`;
}

function rulerPath(len, step, longEvery, horizontal) {
  let d = '';
  for (let v = 0; v <= len; v += step) {
    const l = v % longEvery === 0 ? 9 : 5;
    d += horizontal ? `M${v} 0v${-l}` : `M0 ${v}h${-l}`;
  }
  return d;
}

function rulerLabels(len, every, horizontal) {
  let out = '';
  for (let v = 0; v <= len; v += every) {
    out += horizontal
      ? `<text class="m-num" x="${v}" y="-14" text-anchor="middle">${v}</text>`
      : `<text class="m-num" x="-14" y="${v + 3}" text-anchor="end">${v}</text>`;
  }
  return out;
}

const RULES = [
  ['Dateiformat', 'PNG mit Transparenz'],
  ['Pixelmaße', '3307 × 3685 px'],
  ['Auflösung bei Druckgröße', '300 dpi'],
  ['Passt auf die Druckfläche', '280 × 312 von 330 × 450 mm'],
  ['Transparenter Hintergrund', 'Ränder transparent'],
  ['Halbtransparenz', '0,1 % (Grenze 0,5 %)'],
  ['Linienstärke', '1,2 mm (ab 0,8 mm)'],
  ['Kontrast zum Textil', '1,4 % (Grenze 5 %)'],
];

const CHECK = '<svg class="chk" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path pathLength="1" d="M2.5 8.5l3.5 3.5 7.5-8.5"/></svg>';

function messspur() {
  const rules = RULES.map(([n, v], i) => `<li class="rule r${i + 1}">${CHECK}<span class="r-n">${n}</span><span class="r-v data">${v}</span></li>`).join('\n          ');
  return `<section class="scene" id="messspur" aria-labelledby="scene-h">
    <header class="scene-intro">
      <h2 class="h2" id="scene-h">Gemessen, bevor es rausgeht</h2>
      <p class="scene-p">So prüft der Druckprüfer ein Motiv für Shirtigo: Druckfläche, Maße, Auflösung, Transparenz. Das Schema zeigt Beispielwerte. Gemessen wird in der App, und alles, was Cypher Studio misst, zeichnet es in Cyan auf das Werk.</p>
      <p class="scene-hint lbl" aria-hidden="true">Weiter scrollen</p>
    </header>
    <div class="scene-track">
      <div class="scene-pin">
        <figure class="stage" aria-labelledby="stage-cap">
          <div class="stage-in">
            <svg class="stage-svg" viewBox="-34 -34 398 518" role="img" aria-labelledby="stage-t" focusable="false">
              <title id="stage-t">Schema der Messspur: Druckfläche 330 × 450 Millimeter mit Linealen, einem Motiv von 280 × 312 Millimetern und Maßlinien</title>
              <rect class="m-textil" x="0" y="0" width="330" height="450"/>
              ${motif()}
              <g class="m-axes">
                <path class="mg" d="M165 0V450M0 225H330"/>
                <path class="ml dash" d="M165 0V450M0 225H330"/>
              </g>
              <g class="m-dim">
                <path class="mg" d="M25 352H305M25 346v12M305 346v12M318 26V338M312 26h12M312 338h12"/>
                <path class="ml" d="M25 352H305M25 346v12M305 346v12M318 26V338M312 26h12M312 338h12"/>
              </g>
              <g class="m-frame">
                <rect class="mg" x="0" y="0" width="330" height="450"/>
                <rect class="ml" x="0" y="0" width="330" height="450" pathLength="1"/>
              </g>
              <g class="m-ruler m-ruler-x"><path class="ml m-ticks" pathLength="1" d="${rulerPath(330, 10, 50, true)}"/>${rulerLabels(330, 50, true)}</g>
              <g class="m-ruler m-ruler-y"><path class="ml m-ticks" pathLength="1" d="${rulerPath(450, 10, 50, false)}"/>${rulerLabels(450, 50, false)}</g>
            </svg>
            <p class="mc mc-w" aria-hidden="true"><span class="mc-n mc-n-w"></span></p>
            <p class="mc mc-h" aria-hidden="true"><span class="mc-n mc-n-h"></span></p>
            <p class="mc mc-dim" aria-hidden="true"><span class="mc-n mc-n-mw"></span> × <span class="mc-n mc-n-mh"></span></p>
            <p class="mc mc-dpi" aria-hidden="true">300 dpi</p>
          </div>
          <figcaption class="stage-cap lbl" id="stage-cap">Umfeld hell · Druckfläche Schwarz · Beispielmotiv „Rauschen“ (Platzhalter) · Schema</figcaption>
        </figure>
        <aside class="mess" aria-labelledby="mess-h">
          <h3 class="mess-h lbl" id="mess-h">Messung</h3>
          <div class="verdict" role="status">
            <p class="verdict-wait lbl" aria-hidden="true">Messung läuft …</p>
            <p class="verdict-ok"><svg class="vg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2" y="2" width="16" height="16"/><path d="M5.5 10.5l3 3 6-7"/></svg><span class="verdict-w">Druckbereit</span><span class="verdict-c data">13 Regeln erfüllt</span></p>
          </div>
          <ol class="rules">
          ${rules}
          </ol>
          <p class="rules-more data">+ 5 weitere Regeln, alle erfüllt</p>
          <p class="mess-note">Bildschirm ist kein Farbbeweis. Für kritische Farben bestellst du ein Probeshirt.</p>
        </aside>
      </div>
    </div>
  </section>`;
}

function aufbau(ctx) {
  return `<section class="aufbau" id="aufbau" aria-labelledby="auf-h">
    <div class="auf-text">
      <h2 class="h2" id="auf-h">Eine Oberfläche, drei Zonen</h2>
      <p class="auf-p">Links die Vorschau mit der Messspur, rechts die Messung, unten der Ausgang mit genau einer Aktion. Jedes Modul sieht gleich aus. Wer eins kann, kann alle.</p>
      <dl class="auf-d">
        <div><dt class="lbl">Material</dt><dd>Bibliothek, Programme</dd></div>
        <div><dt class="lbl">Ausgabe</dt><dd>Druck, Mockups, Social</dd></div>
        <div><dt class="lbl">Extra</dt><dd>Freistellen, läuft lokal</dd></div>
        <div><dt class="lbl">Tastatur</dt><dd><kbd>Strg</kbd>+<kbd>Enter</kbd> löst auf jedem Bildschirm den Ausgang aus</dd></div>
      </dl>
    </div>
    <figure class="auf-fig">
      <img class="draw" src="${ctx.imageUrl('app-schema')}" alt="Schema der App: Rail links, Vorschau mit Messspur in der Mitte, Messung rechts, Ausgangsleiste unten" width="${drawingSize('app-schema').w}" height="${drawingSize('app-schema').h}" loading="lazy" decoding="async">
      <figcaption>Schema der Oberfläche. Ein Bildschirmfoto der App folgt mit der ersten Version.</figcaption>
    </figure>
  </section>`;
}

// ── Systemvoraussetzungen und Installieren ───────────────────────

function voraussetzungen(ctx) {
  const r = ctx.config.requirements;
  return `<section class="req" id="voraussetzungen" aria-labelledby="req-h">
    <h2 class="h2 h2-s" id="req-h">Systemvoraussetzungen</h2>
    <dl class="req-d">
      <div><dt class="lbl">Windows</dt><dd>${esc(r.windows)}</dd></div>
      <div><dt class="lbl">macOS</dt><dd>${esc(r.macos)}</dd></div>
      <div><dt class="lbl">Linux</dt><dd>${esc(r.linux)}</dd></div>
      <div><dt class="lbl">Platz</dt><dd>Die Installer sind klein. Für alle vier Programme plane etwa 3 GB frei ein (Richtwert).</dd></div>
      <div><dt class="lbl">Speicher</dt><dd>8 GB Arbeitsspeicher empfohlen, vor allem für Blender und Krita.</dd></div>
      <div><dt class="lbl">Netz</dt><dd>Nur zum Laden der Programme und der Updates. Cypher Studio selbst läuft ohne Internet.</dd></div>
    </dl>
  </section>`;
}

function installieren(ctx) {
  const { installBlocks, release } = ctx;
  const signedAll = release.state === 'released' && release.signed?.windows && release.signed?.macos;
  const why = signedAll
    ? ''
    : `<div class="why">
      <h3 class="why-h">Warum dein System warnt</h3>
      <ul class="why-l">
        <li><strong>Cypher Studio ist noch nicht signiert.</strong> Windows und macOS vertrauen Programmen, deren Herausgeber sie kennen. Dafür braucht es ein Zertifikat, und das kostet laufend Geld (bei Apple 99 US-Dollar im Jahr, bei Windows je nach Anbieter 10 bis 400 US-Dollar).</li>
        <li><strong>Die Warnung heißt nicht, dass die Datei schlecht ist.</strong> Sie heißt: Das System kennt diese Datei noch nicht. Der Quelltext ist offen, und du kannst die Prüfsumme der Datei nachrechnen.</li>
        <li><strong>Wir prüfen die kostenlose Signatur für Open-Source-Projekte</strong> (Windows) und die Beglaubigung durch Apple. Sobald ein System signiert ist, verschwindet hier der Schritt dazu.</li>
      </ul>
    </div>`;
  return `<section class="inst" id="installieren" aria-labelledby="inst-h">
    <header class="inst-head">
      <h2 class="h2" id="inst-h">So öffnest du Cypher Studio</h2>
      <p class="inst-p">Beim ersten Öffnen zeigt dein System eine Warnung. Das ist erwartbar und in zwei Minuten erledigt. Wähle dein System, die Schritte haben Zeichnungen.</p>
    </header>
    ${why}
    <div class="os-list">
      ${installBlocks}
    </div>
  </section>`;
}

// ── Prüfsummen ───────────────────────────────────────────────────

function pruefen(ctx) {
  const { release } = ctx;
  const rel = release.state === 'released';
  const f = rel ? release.files : [];
  const sums = rel
    ? `<ul class="sums">
      ${f.map((x) => `<li class="sum" data-os="${x.os}">
        <div class="sum-h"><a class="sum-name data" href="${esc(x.url)}" download${relAttr(x.url)}>${esc(x.name)}</a><span class="data sum-size">${formatSize(x.size)}</span></div>
        <p class="sum-hash data" id="h-${esc(x.name)}"><span class="sr">SHA-256: </span>${hashGroups(x.sha256).map((g) => `<span class="grp">${g}</span>`).join(' ')}</p>
        <button type="button" class="btn-copy" data-copy-hash="${x.sha256}" hidden aria-label="SHA-256 von ${esc(x.name)} kopieren">Prüfsumme kopieren</button>
      </li>`).join('\n      ')}
    </ul>`
    : `<p class="sums-none">Sobald die erste Version erscheint, steht hier zu jeder Datei die erwartete Prüfsumme in Vierergruppen, mit Knopf zum Kopieren. Die Befehle unten funktionieren schon jetzt.</p>`;
  const name = (key) => ctx.fileName(key);
  return `<section class="sumsec" id="pruefen" aria-labelledby="chk-h">
    <header class="chk-head">
      <h2 class="h2 h2-s" id="chk-h">Selbst prüfen</h2>
      <p class="chk-p">Rechne die Prüfsumme (SHA-256) der Datei nach und vergleiche sie mit dieser Seite. Stimmen alle Gruppen überein, ist es genau die Datei, die wir veröffentlicht haben.${rel ? ` Stand ${datumDe(release.date)}, Version ${esc(release.version)}.` : ''}</p>
    </header>
    ${sums}
    <div class="cmds">
      <div class="cmd"><p class="lbl cmd-l">Windows (PowerShell)</p><div class="code"><pre tabindex="0"><code>Get-FileHash .\\${esc(name('windows'))} -Algorithm SHA256</code></pre><button type="button" class="copy" data-copy hidden aria-label="Befehl für Windows kopieren">Kopieren</button></div></div>
      <div class="cmd"><p class="lbl cmd-l">macOS (Terminal)</p><div class="code"><pre tabindex="0"><code>shasum -a 256 ${esc(name('macos'))}</code></pre><button type="button" class="copy" data-copy hidden aria-label="Befehl für macOS kopieren">Kopieren</button></div></div>
      <div class="cmd"><p class="lbl cmd-l">Linux (Terminal)</p><div class="code"><pre tabindex="0"><code>sha256sum ${esc(name('linux-appimage'))}</code></pre><button type="button" class="copy" data-copy hidden aria-label="Befehl für Linux kopieren">Kopieren</button></div></div>
    </div>
  </section>`;
}

// ── Typenschild ──────────────────────────────────────────────────

function typenschild(ctx) {
  const repo = ctx.config.repoUrl
    ? `<a href="${esc(ctx.config.repoUrl)}" rel="noopener noreferrer">${esc(ctx.config.repoUrl.replace(/^https:\/\//, ''))}</a>`
    : 'Offen, MIT-Lizenz. Der Link folgt, sobald das Repository öffentlich ist.';
  return `<section class="ts" id="typenschild" aria-labelledby="ts-h">
    <h2 class="ts-h lbl" id="ts-h">Typenschild</h2>
    <div class="plate">
      <i class="screw" aria-hidden="true"></i><i class="screw" aria-hidden="true"></i><i class="screw" aria-hidden="true"></i><i class="screw" aria-hidden="true"></i>
      <p class="plate-lead">Gebaut vom Cypher Kollektiv in Berlin, frei zu nutzen und offen zu lesen.</p>
      <dl class="plate-dl">
        <div><dt>Kollektiv</dt><dd>Cypher Kollektiv · Berlin · fünf Leute</dd></div>
        <div><dt>Lizenz</dt><dd>MIT. Die vier Programme behalten ihre eigenen Lizenzen.</dd></div>
        <div><dt>Quelltext</dt><dd>${repo}</dd></div>
        <div><dt>Daten</dt><dd>Keine Konten, keine Telemetrie, keine Cookies, keine Drittquellen.</dd></div>
        <div><dt>Kanäle</dt><dd>${ctx.config.family.map((x) => `<a href="${esc(x.url)}" rel="noopener noreferrer">${esc(x.name)}</a>`).join(' · ')} · Studio (hier)</dd></div>
        <div><dt>Kanal</dt><dd>3 · studio.cypherxcypher.de</dd></div>
      </dl>
    </div>
  </section>`;
}

// ── Seite ────────────────────────────────────────────────────────

export function home(ctx) {
  const { release } = ctx;
  const ver = release.state === 'released' ? `Version ${release.version}<span class="m-x"> · ${datumDe(release.date)}</span>` : 'Testbetrieb<span class="m-x"> · noch keine Version</span>';
  const rulerLabelsHtml = [0, 50, 100, 150, 200, 250, 300].map((n) => `<span class="rl rl-${n}">${n}</span>`).join('') + '<span class="rl rl-330">330 mm</span>';
  const body = `<a class="skip" href="#download">Zum Download springen</a>
<main id="main">
  <section class="tb" id="testbild" aria-labelledby="kennung">
    <div class="tb-grid" aria-hidden="true"></div>
    <div class="ruler" aria-hidden="true">${rulerLabelsHtml}</div>
    <div class="tb-meta">
      <p class="m m-kanal"><span class="m-k" data-ch="studio">Kanal 3 · Studio</span><span class="m-k" data-ch="news" aria-hidden="true">Kanal 1 · News</span><span class="m-k" data-ch="shop" aria-hidden="true">Kanal 2 · Shop</span></p>
      <p class="m m-host">studio.cypherxcypher.de</p>
      <p class="m m-ver">${ver}</p>
    </div>
    <div class="id-wrap">
      <div class="tb-ring" aria-hidden="true"></div>
      <h1 class="id" id="kennung"><span class="w w-cypher">Cypher</span> <span class="w w-studio">Studio</span></h1>
    </div>
    ${downloadBlock(ctx)}
  </section>

  <section class="lead" id="was" aria-labelledby="lead-h">
    <h2 class="sr" id="lead-h">Was Cypher Studio ist</h2>
    <p class="lead-t">Die Zentrale des Cypher Kollektivs. Sie lädt Krita, Inkscape, Blender und Kdenlive aus ihren offiziellen Quellen, prüft die Dateien, richtet die Programme mit unseren Farben, Schriften und Vorlagen ein und prüft Druckdateien für Shirtigo.</p>
    <dl class="lead-d">
      <div><dt class="lbl">Preis</dt><dd class="data">kostenlos</dd></div>
      <div><dt class="lbl">Lizenz</dt><dd class="data">MIT</dd></div>
      <div><dt class="lbl">Konten</dt><dd class="data">keine</dd></div>
      <div><dt class="lbl">Telemetrie</dt><dd class="data">keine</dd></div>
      <div><dt class="lbl">Läuft auf</dt><dd class="data">Windows · macOS · Linux</dd></div>
    </dl>
    <p class="lead-a"><a href="/anleitung/">Anleitung: In 30 Minuten startklar</a></p>
  </section>

  ${programme()}
  ${messspur()}
  ${aufbau(ctx)}
  ${voraussetzungen(ctx)}
  ${installieren(ctx)}
  ${pruefen(ctx)}
  ${typenschild(ctx)}
</main>
${footer(ctx)}`;
  return page(
    {
      title: 'Cypher Studio · Download · Kanal 3',
      description: 'Cypher Studio, die Zentrale des Cypher Kollektivs: lädt Krita, Inkscape, Blender und Kdenlive, richtet sie ein und prüft Druckdateien für Shirtigo. Download für Windows, macOS und Linux.',
      path: '/',
      body,
      bodyClass: 'home',
      themeColor: '#00d4d8',
    },
    ctx,
  );
}
