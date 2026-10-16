import { describe, expect, it } from "vitest";
import { formatCombo, matchesCombo } from "./keys";
import { compareVersions } from "./version";

const ev = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe("Tastenkürzel", () => {
  it("beschriftet Windows und macOS", () => {
    expect(formatCombo("mod+enter", false)).toBe("Strg+↵");
    expect(formatCombo("mod+enter", true)).toBe("⌘↵");
    expect(formatCombo("mod+shift+k", false)).toBe("Strg+Umschalt+K");
    expect(formatCombo("mod+,", false)).toBe("Strg+,");
  });
  it("erkennt Strg unter Windows und ⌘ unter macOS", () => {
    expect(matchesCombo(ev("Enter", { ctrlKey: true }), "mod+enter", false)).toBe(true);
    expect(matchesCombo(ev("Enter", { metaKey: true }), "mod+enter", false)).toBe(false);
    expect(matchesCombo(ev("Enter", { metaKey: true }), "mod+enter", true)).toBe(true);
    expect(matchesCombo(ev("Enter"), "mod+enter", false)).toBe(false);
    expect(matchesCombo(ev("1", { ctrlKey: true }), "mod+1", false)).toBe(true);
    expect(matchesCombo(ev("+", { ctrlKey: true, shiftKey: true }), "mod+plus", false)).toBe(true);
  });
});

describe("Versionsvergleich", () => {
  it("vergleicht punktnumerisch", () => {
    expect(compareVersions("1.4.3", "1.5.0")).toBe(-1);
    expect(compareVersions("5.3.1", "5.3.1")).toBe(0);
    expect(compareVersions("26.08.2", "26.08.10")).toBe(-1);
    expect(compareVersions("5.10", "5.9.9")).toBe(1);
    expect(compareVersions("5.3", "5.3.0")).toBe(0);
  });
});
