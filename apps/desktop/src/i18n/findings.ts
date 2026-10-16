import type { Finding, PrintRuleId } from "@contract";
import { assertNever } from "../lib/assert";
import { fmtBytes, fmtNumber } from "./format";

export interface FindingMessage {
  title: string;
  detail: string;
}

type P = Finding["params"];

const num = (p: P, key: string): number => {
  const v = p[key];
  return typeof v === "number" ? v : 0;
};
const str = (p: P, key: string): string => {
  const v = p[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
};
const mm = (n: number): string => `${fmtNumber(n, n % 1 === 0 ? 0 : 1)} mm`;

/**
 * Deutsche Texte zu jeder Regel des Druckprüfers. Rust liefert Regel-ID + Zahlen (Vertrag), die Wörter stehen hier.
 * Ein Test iteriert über alle `PrintRuleId` (ARCHITEKTUR 8.2).
 */
export function findingText(f: Pick<Finding, "ruleId" | "params">): FindingMessage {
  const p = f.params;
  const id: PrintRuleId = f.ruleId;
  switch (id) {
    case "format.unreadable":
      return { title: "Datei nicht lesbar", detail: "Die Datei lässt sich nicht öffnen. Exportiere sie aus dem Programm als PNG mit 8 Bit." };
    case "format.notUploadable":
      return { title: "Format wird gewandelt", detail: "TIFF und WebP lädt Shirtigo nicht an. Der Export wandelt sie in PNG." };
    case "format.jpegNoAlpha":
      return { title: "JPEG ohne Transparenz", detail: "Ein JPEG hat keinen durchsichtigen Hintergrund: Der weiße Kasten würde mitgedruckt. Exportiere das Motiv als PNG mit Transparenz." };
    case "format.animated":
      return { title: "Animierte PNG", detail: "Nur das erste Bild zählt. Exportiere das Motiv als einfaches PNG." };
    case "format.interlaced":
      return { title: "Verschachtelte PNG", detail: "Shirtigo lehnt verschachtelte (interlaced) Dateien ab. Der Export speichert sie normal." };
    case "format.bitDepth16":
      return { title: "16 Bit pro Kanal", detail: "Der Export rechnet auf 8 Bit um. Farben bleiben für den Druck gleich." };
    case "format.indexed":
      return { title: "Indizierte Farben", detail: "Die Datei nutzt eine Farbpalette. Der Export wandelt sie in RGB." };
    case "size.belowMinPixels":
      return { title: "Zu wenige Pixel", detail: `${num(p, "widthPx")} × ${num(p, "heightPx")} px: Je Seite braucht es mindestens ${num(p, "minPx")} px.` };
    case "size.aboveMaxPixels":
      return { title: "Zu viele Pixel", detail: `${num(p, "widthPx")} × ${num(p, "heightPx")} px: Je Seite sind höchstens ${num(p, "maxPx")} px erlaubt.` };
    case "file.tooLarge":
      return { title: "Datei sehr groß", detail: `${fmtBytes(num(p, "fileBytes"))} bei einer Grenze von ${fmtBytes(num(p, "limitBytes"))}. Schneide leere Ränder ab oder packe verlustfrei stärker.` };
    case "resolution.tooLow":
      return { title: "Auflösung zu niedrig", detail: `Nur ${num(p, "effectiveDpi")} dpi bei dieser Druckbreite, unter 150 dpi druckt unscharf. Verringere die Breite auf höchstens ${num(p, "maxWidthMm")} mm oder lege das Motiv größer an.` };
    case "resolution.belowTarget":
      return { title: "Unter 300 dpi", detail: `${num(p, "effectiveDpi")} dpi bei dieser Druckbreite, Ziel sind ${num(p, "targetDpi")} dpi. Bis ${num(p, "maxWidthMm")} mm Breite bleibt die Auflösung gut.` };
    case "resolution.metadataMismatch":
      return { title: "Auflösung in der Datei falsch", detail: `Die Datei nennt ${num(p, "dpi")} dpi. Der Export schreibt 300 dpi.` };
    case "resolution.upscaleNeeded":
      return { title: "Hochrechnen nötig", detail: "Für 300 dpi müsste das Motiv hochgerechnet werden. Das erfindet keine Details. Besser: als Vektor aus Inkscape exportieren." };
    case "layout.empty":
      return { title: "Kein Motiv gefunden", detail: "Die Datei enthält keine sichtbaren Pixel." };
    case "layout.exceedsPrintArea":
      return { title: "Größer als die Druckfläche", detail: `${mm(num(p, "widthMm"))} × ${mm(num(p, "heightMm"))} passen nicht in ${mm(num(p, "areaWidthMm"))} × ${mm(num(p, "areaHeightMm"))}. Verringere die Druckbreite.` };
    case "layout.exceedsSafeArea":
      return { title: "Über die Sicherheitsfläche hinaus", detail: `${mm(num(p, "widthMm"))} × ${mm(num(p, "heightMm"))} ragen über ${mm(num(p, "safeWidthMm"))} × ${mm(num(p, "safeHeightMm"))} hinaus. Auf kleinen Größen kann das Motiv angeschnitten werden.` };
    case "layout.touchesEdge":
      return { title: "Motiv berührt den Rand", detail: "Der Export schneidet transparente Ränder ohnehin ab; hier ist nichts zu tun." };
    case "color.cmyk":
      return { title: "CMYK-Datei", detail: "Der Export rechnet in RGB um, die Farben verschieben sich. Prüfe das Ergebnis am besten mit einem Probeshirt." };
    case "color.noProfile":
      return { title: "Kein Farbprofil", detail: "Der Export nimmt sRGB an." };
    case "color.unsupportedProfile":
      return { title: "Farbprofil nicht unterstützt", detail: "Der Export rechnet das Profil in Adobe RGB um." };
    case "color.profileDiffers":
      return { title: "Profil wird umgerechnet", detail: `${str(p, "from") || "sRGB"} wird nach ${str(p, "to") || "Adobe RGB"} umgerechnet. Shirtigo empfiehlt Adobe RGB, akzeptiert aber auch sRGB.` };
    case "color.grayscale":
      return { title: "Graustufen", detail: "Das Motiv wird in Grautönen gedruckt." };
    case "color.nearBlack":
      return { title: "Fast-Schwarz", detail: "Fast-Schwarz bekommt eine weiße Unterlage, reines Schwarz (#000000) nicht. Der Export kann auf Reinschwarz setzen." };
    case "alpha.missing":
      return { title: "Kein Alphakanal", detail: "Ohne Transparenz wird das ganze Rechteck gedruckt. Exportiere das Motiv als PNG mit durchsichtigem Hintergrund." };
    case "alpha.opaqueBackground":
      return { title: "Deckender Hintergrund", detail: "Der Hintergrund würde als Fläche mitgedruckt. Entferne ihn, zum Beispiel unter Freistellen." };
    case "alpha.semiTransparent":
      return { title: "Halbtransparente Flächen", detail: `${fmtNumber(num(p, "sharePercent"), 1)} % der sichtbaren Pixel sind halbtransparent. Auf farbigem Textil gibt das einen grauen Schleier, bei DTF druckt es gar nicht. Runde die Transparenz auf 0 oder 100 %.` };
    case "alpha.ghostPixels":
      return { title: "Geisterpixel", detail: `${num(p, "count")} fast unsichtbare Pixel liegen außerhalb des Motivs und würden den Zuschnitt vergrößern.` };
    case "detail.thinLines":
      return { title: "Sehr dünne Linien", detail: `Die dünnste Linie ist ${fmtNumber(num(p, "minStrokeMm"), 1)} mm breit, empfohlen sind mindestens 0,8 mm. Dünne Linien gehen im Druck verloren.` };
    case "contrast.lowOnGarment":
      return { title: "Wenig Kontrast zum Textil", detail: `Ein großer Teil des Motivs hebt sich kaum von „${str(p, "garment")}“ ab. Wähle eine andere Textilfarbe oder färbe das Motiv um.` };
    default:
      return assertNever(id, "PrintRuleId");
  }
}
