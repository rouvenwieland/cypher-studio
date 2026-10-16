import { expect, test, type Page } from "@playwright/test";
import { openApp, settle } from "./helpers";

/** Laufende Animationen und Übergänge mit endlicher Dauer über null (Name:Dauer). */
async function runningMotion(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .map((a) => {
        const t = a.effect?.getComputedTiming();
        const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id;
        return `${name}:${String(t?.duration ?? 0)}`;
      })
      .filter((x) => !x.endsWith(":0")),
  );
}

async function sampleMotion(page: Page, rounds: number): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < rounds; i++) {
    for (const x of await runningMotion(page)) seen.add(x);
    await page.waitForTimeout(100);
  }
  return seen;
}

test.describe("Bewegung (DESIGN.md Vertrag „Bewegung“)", () => {
  test("Systemwunsch „weniger Bewegung“: im ganzen Ablauf läuft keine Animation und kein Übergang", async ({
    page,
  }) => {
    await openApp(page, "programme", { reducedMotion: true, speed: 8, pick: "signal_v3.png" });
    const seen = await sampleMotion(page, 3);
    await page.getByTestId("row-action-blender").click();
    for (const x of await sampleMotion(page, 3)) seen.add(x);
    await page.keyboard.press("Escape");
    await page.getByTestId("nav-print").click();
    await page.getByTestId("print-pick").click();
    for (const x of await sampleMotion(page, 6)) seen.add(x);
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Control+Enter");
    for (const x of await sampleMotion(page, 10)) seen.add(x);
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "done");
    expect([...seen]).toEqual([]);
  });

  test("Ohne den Wunsch läuft die Bewegung (die Ausgangsleiste füllt sich), die Prüfung ist also nicht leer", async ({
    page,
  }) => {
    // Beginn jeder Animation samt wirksamer Dauer aufzeichnen (schneller als Abfragen, auch unter Last)
    await page.addInitScript(() => {
      document.addEventListener(
        "animationstart",
        (e) => {
          const w = window as unknown as { __anim?: string[] };
          (w.__anim ??= []).push(
            `${e.animationName}:${getComputedStyle(e.target as Element, e.pseudoElement || null).animationDuration}`,
          );
        },
        true,
      );
    });
    await openApp(page, "druck", { reducedMotion: false, speed: 8, pick: "signal_v3.png" });
    await page.getByTestId("print-pick").click();
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("print-output")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
    const started = await page.evaluate(() => (window as unknown as { __anim?: string[] }).__anim ?? []);
    expect(started).toContain("outbar-fill:0.24s");
  });

  test("Einstellung „Voll“ gilt vor dem Systemwunsch, „Reduziert“ vor dem Gegenteil", async ({ page }) => {
    await openApp(page, "einstellungen/darstellung", { reducedMotion: true });
    const dur = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-fuellung").trim());
    expect(await dur()).toBe("0ms");
    await page.getByRole("radio", { name: "Voll" }).click();
    await expect.poll(dur).not.toBe("0ms");
    await page.getByRole("radio", { name: "Reduziert" }).click();
    await expect.poll(dur).toBe("0ms");
  });
});

const SCREENS: { name: string; hash: string; prep?: (p: Page) => Promise<void> }[] = [
  { name: "Start", hash: "start" },
  { name: "Programme", hash: "programme" },
  {
    name: "Druckprüfer",
    hash: "druck",
    prep: async (p) => {
      await p.getByTestId("print-pick").click();
      await expect(p.getByTestId("verdict")).toBeVisible();
    },
  },
  {
    name: "Mockups",
    hash: "mockups",
    prep: async (p) => {
      await p.getByTestId("mockup-pick").click();
      await expect(p.getByTestId("mockup-output")).toHaveAttribute("data-state", "ready");
    },
  },
  {
    name: "Social",
    hash: "social",
    prep: async (p) => {
      await p.getByTestId("tpl-drop-ankuendigung").first().click();
      await expect(p.getByTestId("social-stage")).toBeVisible();
    },
  },
  { name: "Freistellen", hash: "freistellen" },
  { name: "Bibliothek", hash: "bibliothek" },
  { name: "Einstellungen", hash: "einstellungen/darstellung" },
];

test.describe("Zoom 200 % und sichtbarer Fokus (WCAG 1.4.4, 1.4.10, 2.4.7)", () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: kein Querscrollen, Ausgang erreichbar, Fokusring sichtbar`, async ({ page }) => {
      await openApp(page, screen.hash, { pick: "signal_v3.png" });
      await screen.prep?.(page);
      // App-Zoom auf 200 % (zehn Schritte à 10 %)
      for (let i = 0; i < 10; i++) await page.keyboard.press("Control+=");
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")))
        .toBe("2");
      await settle(page, 400);

      const metrics = await page.evaluate(() => {
        const out = document.querySelector('[data-region="output"]');
        const r = out?.getBoundingClientRect();
        return {
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          outputInView: r
            ? r.bottom <= window.innerHeight + 1 && r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth + 1
            : null,
        };
      });
      expect(metrics.overflowX, "Querscrollen der Seite").toBeLessThanOrEqual(1);
      if (metrics.outputInView !== null) expect(metrics.outputInView, "Ausgangsleiste im Fenster").toBe(true);

      // Tastaturfokus: jeder der ersten Tab-Stopps trägt einen sichtbaren Ring (Umriss ≥ 2 px, nicht „none“)
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        const ring = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            style: cs.outlineStyle,
            width: Number.parseFloat(cs.outlineWidth),
            shadow: cs.boxShadow,
            visible: r.width > 0 && r.height > 0,
          };
        });
        expect(ring, "Fokus liegt auf einem Element").not.toBeNull();
        if (ring && ring.visible)
          expect(
            (ring.style !== "none" && ring.width >= 2) || ring.shadow !== "none",
            `Fokusring nach Tab ${i + 1}`,
          ).toBe(true);
      }
    });
  }
});
