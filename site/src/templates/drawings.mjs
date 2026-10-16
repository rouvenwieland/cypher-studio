// Eigene Strichzeichnungen für die Anleitung: schematisch, Haarlinien, Knopfbeschriftung in Cyan markiert.
// Keine nachgebauten Betriebssystem-Fenster, keine fremden Logos. Alles Inline-SVG ohne style-Attribute
// (CSP): Farben und Linien kommen aus den Klassen in site.css (.dl, .dp, .dh, .dg, .dt, .dm, .dk, .dx).
const W = 420;
const H = 236;

const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const R = (x, y, w, h, c = 'dl') => `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const L = (x1, y1, x2, y2, c = 'dl') => `<line class="${c}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const T = (x, y, s, c = 'dt', anchor) => `<text class="${c}" x="${x}" y="${y}"${anchor ? ` text-anchor="${anchor}"` : ''}>${e(s)}</text>`;
const P = (pts, c = 'dl') => `<polygon class="${c}" points="${pts}"/>`;
const C = (cx, cy, r, c = 'dl') => `<circle class="${c}" cx="${cx}" cy="${cy}" r="${r}"/>`;

/** Platzhalterzeilen für Text, den es im Original gibt, der hier aber nicht abgebildet wird. */
const greek = (x, y, w, n = 3, gap = 8) => Array.from({ length: n }, (_, i) => R(x, y + i * gap, i === n - 1 ? w * 0.62 : w, 3, 'dg')).join('');
/** Fenster: Rahmen, Titelleiste mit drei Punkten. */
const frame = (x, y, w, h) => R(x, y, w, h, 'dp') + R(x, y, w, 15, 'dbar') + C(x + 9, y + 7.5, 2.2) + C(x + 18, y + 7.5, 2.2) + C(x + 27, y + 7.5, 2.2);
const btn = (x, y, w, h, label, hi = false) => R(x, y, w, h, hi ? 'dh' : 'dp') + T(x + w / 2, y + h / 2 + 3.6, label, 'dt', 'middle');
const arrow = (x1, y1, x2, y2) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hx = (d) => Math.round((x2 - 7 * Math.cos(a + d)) * 10) / 10;
  const hy = (d) => Math.round((y2 - 7 * Math.sin(a + d)) * 10) / 10;
  return L(x1, y1, x2, y2) + P(`${x2},${y2} ${hx(0.45)},${hy(0.45)} ${hx(-0.45)},${hy(-0.45)}`, 'dx');
};
const pointer = (x, y) => P(`${x},${y} ${x},${y + 15} ${x + 4},${y + 11} ${x + 7.5},${y + 18} ${x + 10},${y + 17} ${x + 6.5},${y + 10} ${x + 11.5},${y + 10}`, 'dp');
const svg = (body, title, vb = `0 0 ${W} ${H}`) =>
  `<svg class="draw" viewBox="${vb}" role="img" aria-label="${e(title)}" focusable="false">${body}</svg>`;

// ───────────────────────────── Windows ─────────────────────────────

const winDatei = svg(
  R(36, 52, 72, 92, 'dp') + P('84,52 108,76 84,76', 'dp') + greek(46, 90, 52, 4) + T(72, 130, '.exe', 'dm', 'middle') +
  T(72, 166, '…_x64-setup.exe', 'dm', 'middle') +
  pointer(98, 110) + `<path class="dk" d="M126 96 q8 8 0 16 M134 90 q12 14 0 28"/>` +
  arrow(168, 98, 226, 98) + T(197, 86, 'Doppelklick', 'dm', 'middle') +
  frame(240, 52, 150, 112) + greek(254, 84, 122, 3, 9) + R(254, 126, 122, 8, 'dp') + R(254, 126, 40, 8, 'dh') + T(315, 154, 'Installation läuft', 'dm', 'middle'),
  'Die heruntergeladene Setup-Datei per Doppelklick öffnen',
);

const smartDialog = (inner) => frame(80, 24, 260, 188) + inner;

const winSmart1 = svg(
  smartDialog(
    R(98, 50, 32, 32, 'dx') + L(98, 50, 130, 82) + L(130, 50, 98, 82) +
    R(142, 54, 170, 6, 'dg') + R(142, 66, 120, 6, 'dg') +
    greek(98, 98, 214, 3, 9) +
    R(94, 134, 134, 22, 'dh') + T(161, 149, 'Weitere Informationen', 'dt', 'middle') +
    btn(222, 176, 100, 24, 'Nicht ausführen'),
  ) + arrow(26, 145, 90, 145) + T(14, 122, 'Hier', 'dm') + T(14, 133, 'klicken', 'dm'),
  'Windows meldet, der Computer sei geschützt worden: auf „Weitere Informationen“ klicken',
);

const winSmart2 = svg(
  smartDialog(
    R(98, 50, 32, 32, 'dx') + L(98, 50, 130, 82) + L(130, 50, 98, 82) +
    R(142, 54, 170, 6, 'dg') + R(142, 66, 120, 6, 'dg') +
    T(98, 108, 'App', 'dm') + R(176, 99, 136, 12, 'dh') + T(180, 108, '…_x64-setup.exe', 'dm') +
    T(98, 128, 'Herausgeber', 'dm') + R(176, 119, 136, 12, 'dp') + T(180, 128, 'Unbekannt', 'dm') +
    btn(94, 168, 120, 28, 'Trotzdem ausführen', true) + btn(222, 168, 100, 28, 'Nicht ausführen'),
  ) + T(14, 84, 'Name', 'dm') + T(14, 95, 'prüfen', 'dm'),
  'Nach „Weitere Informationen“: den App-Namen prüfen und „Trotzdem ausführen“ wählen',
);

const winSac = svg(
  frame(40, 24, 340, 188) + R(54, 48, 130, 8, 'dg') + greek(54, 66, 160, 3, 9) +
  T(54, 118, 'Smart App Control', 'dt') +
  R(54, 128, 312, 56, 'dp') +
  R(60, 134, 98, 44, 'dh') + T(109, 160, 'Ein', 'dt', 'middle') +
  R(164, 134, 98, 44, 'dp') + T(213, 160, 'Bewertung', 'dt', 'middle') +
  R(268, 134, 92, 44, 'dp') + T(314, 160, 'Aus', 'dt', 'middle') +
  T(54, 200, '„Ein“ lässt unsignierte Programme gar nicht zu', 'dm'),
  'Smart App Control unter Windows-Sicherheit: bei „Ein“ gibt es keinen Knopf „Trotzdem ausführen“',
);

// ───────────────────────────── macOS ─────────────────────────────

const macDmg = svg(
  frame(40, 24, 340, 188) +
  R(80, 80, 64, 64, 'dp') + `<circle class="dl" cx="112" cy="112" r="20"/>` + L(92, 112, 132, 112) + L(112, 92, 112, 132) +
  T(112, 164, 'Cypher Studio', 'dt', 'middle') +
  arrow(168, 112, 244, 112) + T(206, 100, 'ziehen', 'dm', 'middle') +
  P('268,92 288,92 294,100 336,100 336,144 268,144', 'dp') + T(302, 164, 'Programme', 'dt', 'middle'),
  'Das Disk-Image öffnen und Cypher Studio in den Ordner „Programme“ ziehen',
);

const macBlocked = svg(
  frame(90, 28, 240, 180) +
  R(106, 52, 36, 36, 'dp') + L(106, 52, 142, 88) + L(142, 52, 106, 88) +
  R(154, 56, 160, 6, 'dg') + R(154, 68, 110, 6, 'dg') +
  greek(106, 104, 208, 3, 9) +
  btn(106, 160, 100, 26, 'Fertig', true) + btn(214, 160, 100, 26, 'In den Papierkorb'),
  'Beim ersten Öffnen meldet macOS, die App nicht überprüfen zu können: auf „Fertig“ klicken',
);

const macSettings = svg(
  frame(24, 20, 372, 196) + L(130, 35, 130, 216) +
  R(34, 46, 86, 7, 'dg') + R(34, 62, 70, 7, 'dg') +
  R(32, 76, 92, 20, 'dh') + T(78, 90, 'Datenschutz', 'dm', 'middle') +
  R(34, 108, 76, 7, 'dg') + R(34, 124, 84, 7, 'dg') +
  T(146, 54, 'Sicherheit', 'dt') +
  R(142, 64, 242, 64, 'dp') +
  greek(152, 74, 180, 2, 9) + btn(272, 96, 104, 24, 'Dennoch öffnen', true) +
  R(142, 140, 242, 8, 'dg') + R(142, 156, 200, 8, 'dg') +
  arrow(206, 200, 206, 174) + T(214, 196, 'weiter nach unten scrollen', 'dm'),
  'Systemeinstellungen, Datenschutz & Sicherheit, ganz unten bei „Cypher Studio“ auf „Dennoch öffnen“ klicken',
);

const term = (lines, title) => svg(
  R(24, 28, 372, 180, 'dterm') + R(24, 28, 372, 15, 'dtbar') + C(34, 35.5, 2.2, 'dtd') + C(43, 35.5, 2.2, 'dtd') + C(52, 35.5, 2.2, 'dtd') +
  lines.map(([y, s, c]) => T(36, y, s, c ?? 'dtm')).join(''),
  title,
);

const macTerminal = term(
  [
    [66, '$ xattr -dr com.apple.quarantine \\', 'dtm'],
    [84, '    "/Applications/Cypher Studio.app"', 'dtc'],
    [108, '$ open -a "Cypher Studio"', 'dtm'],
    [150, '# entfernt nur die Download-Markierung', 'dtd2'],
    [166, '# an der App selbst ändert sich nichts', 'dtd2'],
  ],
  'Terminal: nur falls macOS „beschädigt“ meldet, die Download-Markierung mit xattr entfernen',
);

// ───────────────────────────── Linux ─────────────────────────────

const linuxProps = svg(
  frame(60, 22, 300, 192) +
  R(72, 42, 62, 18, 'dp') + T(103, 54.5, 'Allgemein', 'dm', 'middle') + R(136, 42, 86, 18, 'dh') + T(179, 54.5, 'Zugriffsrechte', 'dm', 'middle') +
  greek(72, 78, 276, 2, 9) +
  R(72, 112, 14, 14, 'dh') + L(75, 119, 79, 123) + L(79, 123, 84, 114) +
  T(94, 123, 'Datei als Programm ausführen', 'dt') +
  greek(72, 146, 200, 3, 9) + btn(268, 184, 80, 22, 'Schließen'),
  'Dateieigenschaften: bei „Zugriffsrechte“ den Haken „Datei als Programm ausführen“ setzen',
);

const linuxTerminal = term(
  [
    [64, '$ chmod +x Cypher-Studio_…_amd64.AppImage', 'dtc'],
    [82, '$ ./Cypher-Studio_…_amd64.AppImage', 'dtm'],
    [112, 'dlopen(): error loading libfuse.so.2', 'dtd2'],
    [130, '# Ubuntu 24.04 und neuer:', 'dtd2'],
    [148, '$ sudo apt install libfuse2t64', 'dtc'],
  ],
  'Terminal: AppImage ausführbar machen und starten; bei fehlendem FUSE libfuse2t64 installieren',
);

// ───────────────────────────── Anleitung und Abläufe ─────────────────────────────

/** Schema der App-Oberfläche: Rail, Titelzeile, Vorschau, Messung, Ausgang. */
const appSchema = svg(
  R(16, 16, 388, 204, 'dp') +
  R(16, 16, 74, 204, 'dink') + R(16, 16, 74, 22, 'dh') + R(22, 24, 56, 6, 'dink2') + R(24, 52, 50, 5, 'dgi') + R(24, 66, 40, 5, 'dgi') + R(24, 80, 46, 5, 'dgi') + R(24, 94, 38, 5, 'dgi') +
  R(90, 16, 314, 22, 'dbar') + R(98, 24, 60, 6, 'dg') +
  R(90, 38, 214, 144, 'dumf') + R(130, 54, 134, 112, 'dink') + R(150, 74, 94, 62, 'dpaper') +
  R(124, 48, 146, 124, 'dmess') + T(130, 46, '330 × 450 mm', 'dm') +
  R(304, 38, 100, 144, 'dpanel') + R(312, 48, 84, 18, 'dok') + R(312, 76, 70, 4, 'dg') + R(312, 88, 80, 4, 'dg') + R(312, 100, 62, 4, 'dg') + R(312, 112, 74, 4, 'dg') +
  R(90, 182, 314, 38, 'dpanel') + L(90, 182, 404, 182) + R(98, 196, 120, 5, 'dg') + R(300, 190, 96, 22, 'dh'),
  'Schema der App: Rail links, Vorschau mit Messspur in der Mitte, Messung rechts, Ausgangsleiste unten',
  '0 0 420 236',
);

const zeitplan = svg(
  L(30, 118, 390, 118) +
  Array.from({ length: 7 }, (_, i) => L(30 + i * 60, 112, 30 + i * 60, 124) + T(30 + i * 60, 140, `${i * 5}`, 'dm', 'middle')).join('') +
  T(390, 156, 'Minuten', 'dm', 'end') +
  R(30, 70, 36, 22, 'dh') + T(48, 85, '1', 'dt', 'middle') +
  R(66, 70, 48, 22, 'dh') + T(90, 85, '2', 'dt', 'middle') +
  R(114, 70, 48, 22, 'dh') + T(138, 85, '3', 'dt', 'middle') +
  R(162, 70, 138, 22, 'dp') + T(231, 85, '5 Einrichten', 'dm', 'middle') +
  R(300, 70, 90, 22, 'dp') + T(345, 85, '6 Probelauf', 'dm', 'middle') +
  R(114, 40, 276, 20, 'dg') + R(114, 40, 190, 20, 'dh') + T(120, 54, '4 Programme laden · Hintergrund', 'dm') +
  T(30, 188, '1 Auswahl · 2 Ordner · 3 Prüfen und zustimmen', 'dm'),
  'Zeitplan: etwa 30 Minuten, Download läuft im Hintergrund parallel zu Einrichtung und Probelauf',
);

const box = (x, lines, hi = false) =>
  R(x, 78, 84, 80, hi ? 'dh' : 'dp') + lines.map((t, i) => (i === 0 ? T(x + 42, 104, t, 'dt', 'middle') : T(x + 42, 104 + i * 14, t, 'dm', 'middle'))).join('');

const flowDruck = svg(
  box(12, ['Motiv', 'Krita', 'Inkscape']) + arrow(98, 118, 114, 118) +
  box(116, ['Druckprüfer', 'misst', 'rechnet'], true) + arrow(202, 118, 218, 118) +
  box(220, ['PNG', '300 dpi', 'RGB']) + arrow(306, 118, 322, 118) +
  box(324, ['Shirtigo', 'hochladen', 'im Cockpit']) +
  T(12, 190, 'Gespeichert unter Export/Druck/ im Projekt', 'dm'),
  'Ablauf: Motiv in Krita oder Inkscape, im Druckprüfer messen, als PNG exportieren, bei Shirtigo hochladen',
);

const zonenReel = svg(
  R(110, 10, 120, 216, 'dp') +
  R(110, 10, 120, 25, 'dhatch') + R(110, 179, 120, 47, 'dhatch') + R(217, 35, 13, 144, 'dhatch') +
  R(110, 35, 107, 144, 'dmess') +
  T(163, 117, 'sicher', 'dt', 'middle') +
  T(14, 112, '1080 × 1920 px', 'dm') +
  T(250, 56, 'oben 220 px', 'dm') + T(250, 72, 'unten 420 px', 'dm') + T(250, 88, 'rechts 120 px', 'dm') +
  T(250, 116, 'sicher:', 'dm') + T(250, 130, '960 × 1280 px', 'dm'),
  'Reel-Format 1080 × 1920 Pixel mit Sicherheitszonen oben 220, unten 420 und rechts 120 Pixel',
);

const flow3d = svg(
  box(12, ['Blender', 'Cypher Export', 'prüft Budget']) + arrow(98, 118, 114, 118) +
  box(116, ['.glb', '+ .webp', 'extern'], true) + arrow(202, 118, 218, 118) +
  box(220, ['Lizenz', '.lizenz.json', 'danebenlegen']) + arrow(306, 118, 322, 118) +
  box(324, ['Shop', 'Rundgang', 'lädt .glb']) +
  T(12, 190, 'Texturen als eigene Dateien neben der .glb, nie eingebettet', 'dm'),
  'Ablauf: Modell in Blender prüfen, als GLB mit externen Texturen exportieren, Lizenzdatei ablegen, im Shop-Rundgang einsetzen',
);

export const drawings = {
  'win-datei': winDatei,
  'win-smartscreen-1': winSmart1,
  'win-smartscreen-2': winSmart2,
  'win-sac': winSac,
  'mac-dmg': macDmg,
  'mac-blockiert': macBlocked,
  'mac-einstellungen': macSettings,
  'mac-terminal': macTerminal,
  'linux-eigenschaften': linuxProps,
  'linux-terminal': linuxTerminal,
  'app-schema': appSchema,
  zeitplan,
  'flow-druck': flowDruck,
  'zonen-reel': zonenReel,
  'flow-3d': flow3d,
};

export function drawing(name) {
  const d = drawings[name];
  if (!d) throw new Error(`Unbekannte Zeichnung: ${name}`);
  return d;
}
