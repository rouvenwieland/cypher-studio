// Anleitungsseiten (aus Markdown) und die kleinen Seiten: Impressum, Datenschutz, 404.
import { esc, footer, page, topbar } from './layout.mjs';

/**
 * @param {object} doc  { slug, titel, beschreibung, lead, stand, html, headings }
 * @param {object[]} all alle Anleitungsseiten für die Weiterleitung unten
 */
export function docPage(doc, all, ctx) {
  const toc = doc.headings.filter((h) => h.level === 2);
  const others = all.filter((d) => d.slug !== doc.slug);
  const body = `<a class="skip" href="#inhalt">Zum Inhalt springen</a>
${topbar('anleitung')}
<main id="main">
  <header class="phead">
    ${doc.slug === 'anleitung' ? '' : '<nav class="crumb lbl" aria-label="Pfad"><a href="/anleitung/">Anleitung</a><span aria-hidden="true"> / </span><span aria-current="page">Ablauf</span></nav>'}
    <h1 class="phead-t">${esc(doc.titel)}</h1>
    <p class="phead-lead">${esc(doc.lead)}</p>
    ${doc.stand ? `<p class="phead-stand lbl">${esc(doc.stand)}</p>` : ''}
  </header>
  <div class="dwrap">
    ${toc.length > 1 ? `<nav class="toc" aria-label="Auf dieser Seite"><p class="lbl toc-l">Auf dieser Seite</p><ol>${toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>` : '<div></div>'}
    <article class="prose" id="inhalt">
${doc.html}
    </article>
  </div>
  <nav class="more" aria-labelledby="more-h">
    <h2 class="more-h lbl" id="more-h">Weiter lesen</h2>
    <ul class="more-l">
      ${others.map((d) => `<li><a class="more-a" href="${d.path}"><span class="more-t">${esc(d.titel)}</span><span class="more-d">${esc(d.beschreibung)}</span><svg class="more-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15M13 6l6 6-6 6"/></svg></a></li>`).join('\n      ')}
      <li><a class="more-a" href="/#download"><span class="more-t">Zum Download</span><span class="more-d">Cypher Studio für Windows, macOS und Linux.</span><svg class="more-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15M13 6l6 6-6 6"/></svg></a></li>
    </ul>
  </nav>
</main>
${footer(ctx)}`;
  return page(
    { title: `${doc.titel} · Cypher Studio`, description: doc.beschreibung, path: doc.path, body, bodyClass: 'doc-page', themeColor: '#00d4d8' },
    ctx,
  );
}

function plain({ title, description, path, h1, flag, bodyHtml, bodyClass = 'doc plain', active }, ctx) {
  const body = `<a class="skip" href="#inhalt">Zum Inhalt springen</a>
${topbar(active)}
<main class="plain-main" id="inhalt">
  <h1 class="plain-h${bodyClass.includes('nosig') ? ' plain-h-xl' : ''}">${esc(h1)}</h1>
  ${flag ? `<p class="plain-flag lbl">${esc(flag)}</p>` : ''}
  <div class="plain-body">
${bodyHtml}
  </div>
</main>
${footer(ctx, { markenhinweis: false })}`;
  return page({ title, description, path, body, bodyClass }, ctx);
}

export function impressum(ctx) {
  return plain(
    {
      title: 'Impressum · Cypher Studio',
      description: 'Impressum der Seite studio.cypherxcypher.de (Platzhalter).',
      path: '/impressum/',
      h1: 'Impressum',
      flag: 'Platzhalter',
      bodyHtml: `    <p>Die Cypher Kollektiv GbR ist in Gründung. Sobald sie gegründet ist, stehen hier die Pflichtangaben: Name und Anschrift der Gesellschaft, die vertretungsberechtigten Gesellschafter und ein Kontaktweg.</p>
    <p>Bis dahin ist diese Seite im Testbetrieb und für Suchmaschinen gesperrt (noindex).</p>`,
    },
    ctx,
  );
}

export function datenschutz(ctx) {
  return plain(
    {
      title: 'Datenschutz · Cypher Studio',
      description: 'Datenschutzhinweise der Seite studio.cypherxcypher.de (Platzhalter).',
      path: '/datenschutz/',
      h1: 'Datenschutz',
      flag: 'Platzhalter',
      bodyHtml: `    <p>Die vollständige Datenschutzerklärung folgt mit der Gründung der Cypher Kollektiv GbR. Technisch gilt für diese Seite schon heute:</p>
    <ul>
      <li>Keine Cookies, kein Tracking, keine Analyse-Werkzeuge, nichts wird im Browser gespeichert.</li>
      <li>Keine Inhalte von Dritten: Schriften, Bilder und Skripte kommen von diesem Server.</li>
      <li>Gehostet bei Cloudflare. Beim Aufruf verarbeitet Cloudflare die technisch nötigen Verbindungsdaten (zum Beispiel die IP-Adresse), um die Seite auszuliefern und abzusichern.</li>
      <li>Cypher Studio selbst sendet keine Telemetrie und legt keine Konten an. Welche Adressen die App anfragt, steht in ihren Einstellungen unter „Netzwerk und Daten“.</li>
    </ul>
    <p>Diese Hinweise gelten für diese Seite, nicht für die verlinkten Kanäle und Projektseiten.</p>`,
    },
    ctx,
  );
}

export function notFound(ctx) {
  const body = `${topbar('')}
<main class="nosig" id="inhalt">
  <div class="nosig-ring" aria-hidden="true"></div>
  <h1 class="nosig-h">Kein Signal</h1>
  <p class="nosig-p">Auf dieser Adresse sendet nichts. Vielleicht ein Tippfehler, vielleicht ein alter Link.</p>
  <p class="nosig-a"><a href="/">Zurück zur Kennung</a></p>
  <p class="nosig-m lbl">Fehler 404 · Kanal 3</p>
</main>
${footer(ctx, { markenhinweis: false })}`;
  return page(
    { title: 'Kein Signal · Cypher Studio', description: 'Diese Seite gibt es nicht.', path: '/404.html', body, bodyClass: 'doc nosig-page', themeColor: '#0d0d0d' },
    ctx,
  );
}
