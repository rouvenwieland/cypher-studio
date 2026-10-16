/**
 * Zahlen-, Größen- und Zeitformate nach DESIGN.md „Typografie“ und CONCEPT.md 7:
 * Pixelmaße ohne Tausenderpunkt (3898 × 5315 px), Mengen mit Punkt (3.104 Dateien), Dezimalkomma (11,2 MB),
 * Datum 16.10.2026, Zeit 14:32, relative Zeit nur bis gestern.
 */
import { now } from "../lib/clock";

const NF_INT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nfCache = new Map<number, Intl.NumberFormat>();

function nf(digits: number): Intl.NumberFormat {
  let f = nfCache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    nfCache.set(digits, f);
  }
  return f;
}

/** Menge mit Tausenderpunkt: 3104 → „3.104“. */
export function fmtCount(n: number): string {
  return NF_INT.format(n);
}

/** Zahl mit festen Nachkommastellen und Dezimalkomma, ohne Tausenderpunkt. */
export function fmtNumber(n: number, digits = 0): string {
  return nf(digits).format(n);
}

/** Pixelmaß ohne Tausenderpunkt: „3898 × 5315 px“. */
export function fmtPx(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)} px`;
}

export function fmtMm(n: number, digits = 1): string {
  return `${nf(digits).format(n)} mm`;
}

export function fmtMmSize(width: number, height: number, digits = 1): string {
  return `${nf(digits).format(width)} × ${nf(digits).format(height)} mm`;
}

export function fmtDpi(n: number): string {
  return `${nf(0).format(Math.round(n))} dpi`;
}

/** Anteil (0..1) als Prozent mit Dezimalkomma: 0.021 → „2,1 %“. */
export function fmtPercent(share: number, digits = 1): string {
  return `${nf(digits).format(share * 100)} %`;
}

/** Größe in Bytes, 1024er-Schritte, Beschriftung wie im Betriebssystem („MB“): 11,2 MB · 182 MB · 1,2 GB. */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const name = units[unit] ?? "B";
  if (unit === 0) return `${Math.round(value)} ${name}`;
  const digits = value >= 100 ? 0 : 1;
  const text = nf(digits).format(value);
  return `${text.replace(/,0$/, "")} ${name}`;
}

/** Nur die Zahl der Megabyte für „74 von 182 MB“. */
export function fmtMegabytes(bytes: number): string {
  return nf(bytes / (1024 * 1024) >= 100 ? 0 : 1).format(bytes / (1024 * 1024)).replace(/,0$/, "");
}

export function fmtRate(bytesPerSecond: number): string {
  return `${fmtBytes(bytesPerSecond)}/s`;
}

function parts(date: Date, timeZone: string | undefined): { d: string; m: string; y: string; hh: string; mm: string } {
  const f = new Intl.DateTimeFormat("de-DE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { d: o["day"] ?? "", m: o["month"] ?? "", y: o["year"] ?? "", hh: o["hour"] ?? "", mm: o["minute"] ?? "" };
}

export function fmtDate(iso: string, timeZone?: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.d}.${p.m}.${p.y}`;
}

export function fmtTime(iso: string, timeZone?: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.hh}:${p.mm}`;
}

export function fmtDateTime(iso: string, timeZone?: string): string {
  return `${fmtDate(iso, timeZone)} ${fmtTime(iso, timeZone)}`;
}

/** „heute 14:32“, „gestern“, sonst „12.10.2026“. */
export function fmtRelative(iso: string, reference: Date = now(), timeZone?: string): string {
  const day = (d: Date) => {
    const p = parts(d, timeZone);
    return Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d));
  };
  const diffDays = Math.round((day(reference) - day(new Date(iso))) / 86_400_000);
  if (diffDays === 0) return `heute ${fmtTime(iso, timeZone)}`;
  if (diffDays === 1) return "gestern";
  return fmtDate(iso, timeZone);
}

/** Restzeit grob und ehrlich: „unter 1 Min.“, „noch etwa 24 Min.“. */
export function fmtRemaining(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "noch unter 1 Min.";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `noch etwa ${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `noch etwa ${h} Std. ${m} Min.`;
}

/** Gruppen zu je vier Zeichen: „9f3a 1c0e …“. */
export function checksumGroups(sha: string): string[] {
  return sha.match(/.{1,4}/g) ?? [];
}

/** Gekürzte Anzeige „9f3a 1c0e … 77b2 d4e1“. */
export function checksumShort(sha: string): string {
  const g = checksumGroups(sha);
  if (g.length <= 4) return g.join(" ");
  return `${g.slice(0, 2).join(" ")} … ${g.slice(-2).join(" ")}`;
}

/** Kürzt in der Mitte, damit Endung und Anfang lesbar bleiben: rauschen_sig…_v3.kra. */
export function ellipsizeMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.45);
  const head = keep - tail;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** Pfade in der Mitte kürzen, Laufwerk und letzter Teil bleiben stehen. */
export function ellipsizePath(path: string, max: number): string {
  if (path.length <= max) return path;
  const sep = path.includes("\\") ? "\\" : "/";
  const segments = path.split(sep);
  if (segments.length <= 3) return ellipsizeMiddle(path, max);
  const first = segments[0] ?? "";
  const last = segments.slice(-2).join(sep);
  const candidate = `${first}${sep}…${sep}${last}`;
  return candidate.length <= max ? candidate : ellipsizeMiddle(candidate, max);
}
