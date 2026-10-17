import { expect, test } from "@playwright/test";
import { openApp, settle } from "./helpers";

/** Fenstergrößen: Mindestfenster, Windows mit 125 % auf 1366 × 768 (≈ 1093 × 614 CSS-px), Standard, Full HD. */
const SIZES = [
  { w: 1024, h: 680 },
  { w: 1093, h: 614 },
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 },
];

for (const size of SIZES) {
  test.describe(`Rail bei ${size.w} × ${size.h}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });

    test("aktiver Eintrag trägt die Klasse und die Optik, Ziele ≥ 32 px, Symbole mittig", async ({ page }) => {
      await openApp(page, "druck");
      await settle(page, 300);
      const current = page.locator('.rail a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveClass(/rail__item--on/);
      const links = await page.evaluate(() =>
        [...document.querySelectorAll(".rail a.rail__item")].map((a) => {
          const r = a.getBoundingClientRect();
          const icon = a.querySelector("svg")?.getBoundingClientRect();
          return {
            cls: a.getAttribute("class") ?? "",
            h: Math.round(r.height),
            w: Math.round(r.width),
            iconCenterOffset: icon ? Math.round(icon.left + icon.width / 2 - (r.left + r.width / 2)) : null,
            bg: getComputedStyle(a).backgroundColor,
          };
        }),
      );
      expect(links.length).toBeGreaterThanOrEqual(7);
      for (const l of links) {
        // kein Funktionsquelltext im class-Attribut (Radix asChild machte daraus eine Zeichenkette)
        expect(l.cls).not.toContain("=>");
        expect(l.cls).toMatch(/^rail__item( rail__item--on)?( active)?$/);
        expect(l.h).toBeGreaterThanOrEqual(32);
        if (size.w < 1180) expect(Math.abs(l.iconCenterOffset ?? 99)).toBeLessThanOrEqual(2);
      }
      const on = links.filter((l) => l.cls.includes("rail__item--on"));
      expect(on).toHaveLength(1);
      expect(on[0]?.bg).not.toBe("rgba(0, 0, 0, 0)");
    });

    test("die Hauptansichten laufen über: kein Querscrollen, Ausgangsleiste im Fenster", async ({ page }) => {
      for (const hash of ["start", "programme", "druck", "mockups", "social", "freistellen", "bibliothek"]) {
        await openApp(page, hash);
        await settle(page, 250);
        const m = await page.evaluate(() => {
          const out = document.querySelector('[data-region="output"]')?.getBoundingClientRect();
          return {
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            outputVisible: out ? out.bottom <= window.innerHeight + 1 && out.right <= window.innerWidth + 1 : true,
          };
        });
        expect(m.overflowX, `Querscrollen auf ${hash}`).toBeLessThanOrEqual(1);
        expect(m.outputVisible, `Ausgangsleiste auf ${hash}`).toBe(true);
      }
    });
  });
}
