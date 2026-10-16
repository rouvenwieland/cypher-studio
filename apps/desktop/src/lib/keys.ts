import { isMacPlatform } from "./platform";

/**
 * Kürzel-Notation: "mod+enter", "mod+shift+k", "f6", "?" – `mod` ist Strg (Windows, Linux) bzw. ⌘ (macOS).
 */
export function formatCombo(combo: string, mac: boolean = isMacPlatform()): string {
  const parts = combo.split("+");
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw.trim().toLowerCase();
    switch (part) {
      case "mod":
        out.push(mac ? "⌘" : "Strg");
        break;
      case "shift":
        out.push(mac ? "⇧" : "Umschalt");
        break;
      case "alt":
        out.push(mac ? "⌥" : "Alt");
        break;
      case "enter":
        out.push("↵");
        break;
      case "escape":
      case "esc":
        out.push("Esc");
        break;
      case "space":
        out.push("Leertaste");
        break;
      case "left":
        out.push("←");
        break;
      case "right":
        out.push("→");
        break;
      case "up":
        out.push("↑");
        break;
      case "down":
        out.push("↓");
        break;
      case ",":
        out.push(",");
        break;
      default:
        out.push(part.length === 1 ? part.toUpperCase() : part.toUpperCase());
    }
  }
  return mac ? out.join("") : out.join("+");
}

export interface ComboEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Prüft, ob ein Tastaturereignis zur Notation passt. */
export function matchesCombo(e: ComboEvent, combo: string, mac: boolean = isMacPlatform()): boolean {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const key = parts[parts.length - 1] ?? "";
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (wantMod !== mod) return false;
  if (!mac && e.metaKey) return false;
  if (wantShift !== e.shiftKey && key.length > 1) return false;
  if (wantAlt !== e.altKey) return false;
  const pressed = e.key.toLowerCase();
  const aliases: Record<string, string> = { plus: "+", esc: "escape", space: " ", left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown" };
  const want = aliases[key] ?? key;
  return pressed === want;
}

/** Ist das Ziel ein Texteingabefeld? Einzeltasten dürfen dort nie greifen (WCAG 2.1.4). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range"].includes(type);
  }
  return false;
}
