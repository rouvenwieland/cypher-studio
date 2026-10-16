// Gemeinsamer Rahmen aller Seiten: Kopf (meta, Schriften, Skripte), Fuß mit Markenhinweis.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const MARKENHINWEIS =
  'Krita, Inkscape, Blender und Kdenlive sind Marken ihrer jeweiligen Inhaber (Stichting Krita Foundation, Software Freedom Conservancy, Blender Foundation, KDE e.V.). Cypher Studio ist kein offizielles Produkt dieser Projekte und lädt sie unverändert aus ihren offiziellen Quellen.';

/**
 * @param {object} p
 * @param {string} p.title      <title>
 * @param {string} p.description
 * @param {string} p.path       kanonischer Pfad, z. B. "/anleitung/"
 * @param {string} p.body       Inhalt von <body>
 * @param {string} [p.bodyClass]
 * @param {string} [p.themeColor]
 * @param {boolean} [p.home]    lädt zusätzlich die Skripte der Startseite
 */
export function page({ title, description, path, body, bodyClass = '', themeColor = '#efeee9' }, ctx) {
  const a = ctx.assets;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${themeColor}">
<meta name="color-scheme" content="light">
<link rel="canonical" href="${esc(ctx.config.siteUrl + path)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${a['fonts/anybody.woff2']}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${a['fonts/martian-mono.woff2']}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${a['fonts/atkinson.woff2']}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${a['css/site.css']}">
<script src="${a['js/boot.js']}"></script>
<script src="${a['js/site.js']}" defer></script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
</body>
</html>
`;
}

/** Kopfleiste der Unterseiten. */
export function topbar(current) {
  const link = (href, label, key) =>
    `<a class="lbl nav-l"${current === key ? ' aria-current="page"' : ''} href="${href}">${label}</a>`;
  return `<header class="doc-top">
  <a class="lbl doc-home" href="/"><span class="doc-dot" aria-hidden="true"></span>Cypher Studio</a>
  <nav class="doc-nav" aria-label="Seitenbereiche">
    ${link('/#download', 'Download', 'download')}
    ${link('/anleitung/', 'Anleitung', 'anleitung')}
    ${link('/#pruefen', 'Prüfsummen', 'pruefen')}
  </nav>
</header>`;
}

export function footer(ctx, { markenhinweis = true } = {}) {
  return `<footer class="foot">
  ${markenhinweis ? `<p class="foot-brand">${esc(MARKENHINWEIS)}</p>` : ''}
  <p class="lbl foot-l">© 2026 Cypher Kollektiv (GbR in Gründung) · Kanal 3 · Testbetrieb</p>
  <p class="lbl foot-links"><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a></p>
</footer>`;
}
