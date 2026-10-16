// Cypher Studio · Downloader-Seite. Verbesserungen, die Seite funktioniert auch ohne sie:
// 1. Kopieren-Knöpfe, 2. Anleitung für das erkannte System aufklappen, 3. nach dem Download dorthin springen,
// 4. einmaliger Suchlauf durch die Kanäle (Orange → Gelb → Cyan).
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // iOS setzt :active (Schnitt beim Antippen) nur mit einem Touch-Listener
  addEventListener('touchstart', function () {}, { passive: true });

  // ── Meldungen für Screenreader ─────────────────────────────
  var live = document.createElement('p');
  live.className = 'sr';
  live.setAttribute('role', 'status');
  document.body.appendChild(live);
  function say(text) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }

  var os = root.getAttribute('data-os');

  // ── 1. Kopieren ────────────────────────────────────────────
  var canCopy = !!(navigator.clipboard && navigator.clipboard.writeText);
  function copy(btn, text, doneLabel) {
    navigator.clipboard.writeText(text).then(function () {
      var old = btn.textContent;
      btn.textContent = doneLabel;
      btn.classList.add('is-done');
      say('Kopiert');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('is-done'); }, 1800);
    }, function () { say('Kopieren nicht möglich'); });
  }
  if (canCopy) {
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      var code = btn.parentElement && btn.parentElement.querySelector('code');
      if (!code) return;
      btn.hidden = false;
      btn.addEventListener('click', function () { copy(btn, code.textContent.replace(/\n$/, ''), 'Kopiert'); });
    });
    document.querySelectorAll('[data-copy-hash]').forEach(function (btn) {
      btn.hidden = false;
      btn.addEventListener('click', function () { copy(btn, btn.getAttribute('data-copy-hash'), 'Kopiert'); });
    });
    document.querySelectorAll('[data-copy-page]').forEach(function (btn) {
      var src = document.querySelector('[data-copy-src]');
      btn.hidden = false;
      btn.addEventListener('click', function () { copy(btn, src ? src.textContent.trim() : location.origin + '/', 'Kopiert'); });
    });
  }

  // ── 1b. Handy: Dateinamen in der Prüfsummenliste sind nur Text, nichts lädt versehentlich 80 MB aufs Handy ──
  if (os === 'android' || os === 'ios') {
    document.querySelectorAll('a[download]').forEach(function (a) {
      var span = document.createElement('span');
      span.className = a.className;
      span.textContent = a.textContent;
      a.replaceWith(span);
    });
  }

  // ── 2. Anleitung für das erkannte System aufklappen ────────
  function openGuide(name, focus) {
    var d = document.getElementById(name);
    if (!d || d.tagName !== 'DETAILS') return null;
    d.open = true;
    if (focus) {
      var s = d.querySelector('summary');
      d.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
      if (s) s.focus({ preventScroll: true });
    }
    return d;
  }
  var hash = location.hash.replace('#', '');
  if (/^(windows|macos|linux)$/.test(hash)) openGuide(hash, false);
  else if (/^(windows|macos|linux)$/.test(os || '')) { var g = document.getElementById(os); if (g && g.tagName === 'DETAILS') g.open = true; }
  addEventListener('hashchange', function () {
    var h = location.hash.replace('#', '');
    if (/^(windows|macos|linux)$/.test(h)) openGuide(h, false);
  });

  // ── 3. Nach dem Download: Anleitung für das System nach oben ─
  document.querySelectorAll('a[data-dl]').forEach(function (a) {
    a.addEventListener('click', function () {
      var target = a.getAttribute('data-dl');
      // Der Download läuft im Browser weiter; wir blättern nur zur Anleitung.
      setTimeout(function () { if (document.getElementById(target)) openGuide(target, true); }, 450);
    });
  });

  // ── 4. Suchlauf: nur beim frischen Aufruf von außen, nie bei reduzierter Bewegung, jede Eingabe bricht ab ──
  var tb = document.querySelector('.tb');
  if (!tb) return;
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var fromFamily = false;
  try { fromFamily = /(^|\.)cypherxcypher\.de$/.test(new URL(document.referrer).hostname); } catch (e) { /* kein Referrer */ }
  if (reduce.matches || fromFamily || location.hash || (nav && nav.type !== 'navigate') || window.__cxStill) return; // __cxStill: nur Tests (Standbilder)

  var order = ['news', 'shop'];
  var STEP = 800; // ≥ 800 ms je Schnitt: höchstens 1,25 Wechsel pro Sekunde (WCAG 2.3.1)
  var i = 0;
  var timer = 0;
  var inputs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
  function stop() {
    clearTimeout(timer);
    delete tb.dataset.on;
    inputs.forEach(function (t) { removeEventListener(t, stop, true); });
    if (reduce.removeEventListener) reduce.removeEventListener('change', stop);
  }
  function step() {
    if (i < order.length) { tb.dataset.on = order[i++]; timer = setTimeout(step, STEP); } else stop();
  }
  inputs.forEach(function (t) { addEventListener(t, stop, { capture: true, passive: true }); });
  if (reduce.addEventListener) reduce.addEventListener('change', stop);
  timer = setTimeout(step, 900);
})();
