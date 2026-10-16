// Cypher Studio · Systemerkennung vor dem ersten Bild (blockierend, klein, ohne Abhängigkeiten).
// Setzt <html data-os="windows|macos|linux|android|ios|other">. Nur zum Sortieren und Beschriften:
// Es gibt nie einen automatischen Download. Ohne JavaScript stehen alle drei Systeme gleichrangig da.
(function () {
  'use strict';

  /**
   * @param {{userAgent?: string, platform?: string, maxTouchPoints?: number, userAgentData?: {platform?: string, mobile?: boolean}}} nav
   * @returns {'windows'|'macos'|'linux'|'android'|'ios'|'other'}
   */
  function detectOs(nav) {
    var ua = (nav && nav.userAgent) || '';
    var uad = nav && nav.userAgentData;
    var p = ((uad && uad.platform) || '').toLowerCase();
    var touch = (nav && nav.maxTouchPoints) || 0;
    if (/android/i.test(ua) || p === 'android') return 'android';
    if (/iphone|ipad|ipod/i.test(ua) || p === 'ios') return 'ios';
    // iPadOS meldet sich als Mac, hat aber einen Touchscreen
    if (p === 'macos' || /macintosh|mac os x/i.test(ua)) return touch > 1 ? 'ios' : 'macos';
    if (p === 'windows' || /windows nt/i.test(ua)) return 'windows';
    if (/cros/i.test(ua) || p === 'chrome os') return 'other';
    if (p === 'linux' || /linux|x11/i.test(ua)) return 'linux';
    if (uad && uad.mobile) return 'android';
    return 'other';
  }

  var os = 'other';
  try { os = detectOs(navigator); } catch (e) { /* Erkennung ist nur Beiwerk */ }
  document.documentElement.setAttribute('data-os', os);
  window.cxDetectOs = detectOs;
})();
