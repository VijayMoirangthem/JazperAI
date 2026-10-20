import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office 2 flows. Launch pattern copied from app.spec.ts (real Electron window). Each office2 prompt appends tests at the END of this file.
const root = path.resolve(__dirname, "../..");
const SHOTS = path.join(__dirname, "..", "test-results", "office2");

declare global {
  interface Window {
    __officeFps?: number; __officeFrameMs?: number; __officePeople?: number;
    __officeDebug?: {
      people(): { slug: string; x: number; y: number; state: string; place: string }[];
      tags(): { slug: string; x: number; y: number; w: number; h: number; visible: boolean }[];
      camera(): { x: number; y: number; zoom: number };
      groups(): string[][];
      bubbleOf(slug: string): { x: number; y: number; text: string } | null;
      screenOf(slug: string): { x: number; y: number } | null;
      walkTo(slug: string, tx: number, ty: number): void;
    };
  }
}

function launchEnv(): Record<string, string> {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // even an empty value makes Electron run as plain Node
  return env;
}

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

async function openPanel(id: string, query = "") {
  await page.evaluate(([h, q]) => { window.location.hash = h + q; }, [id, query]);
}
async function shot(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test.beforeAll(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-office2-"));
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
    env: launchEnv(),
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  for (const id of ["team_chat", "office2"]) {
    await page.evaluate((h) => { window.location.hash = h; }, id);
    await page.waitForTimeout(4000);
    await page.waitForLoadState("load");
  }
  consoleErrors.length = 0;
}, 240_000);

test.afterAll(async () => { await app?.close(); });

test("[P05] office2 mounts one canvas and publishes fps", async () => {
  await openPanel("office2");
  await expect(page.locator('[data-testid="office2-host"] canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__officeFps ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await page.locator('[data-testid="office2-host"] canvas').count()).toBe(1);
  await shot("p05");
  expect(consoleErrors.filter((e) => !/favicon|DevTools|Download the React DevTools/.test(e))).toEqual([]);
});

test("[P07] people appear on distinct spots inside the world", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const people = await page.evaluate(() => window.__officeDebug!.people());
  expect(people.every((p) => p.x > 0 && p.x < 1920 && p.y > 0 && p.y < 1280)).toBe(true);
  expect(new Set(people.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBe(people.length);
  await shot("p07");
});

test("[P08] no two visible name tags overlap, even in a crowd", async () => {
  await openPanel("office2", "?bots=40&gather=lounge");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(40);
  for (let i = 0; i < 40; i++) { // wait until everybody has stopped walking
    const a = JSON.stringify(await page.evaluate(() => window.__officeDebug!.people().map((p) => [p.x, p.y])));
    await page.waitForTimeout(700);
    if (a === JSON.stringify(await page.evaluate(() => window.__officeDebug!.people().map((p) => [p.x, p.y])))) break;
  }
  await page.waitForTimeout(700);
  const tags = (await page.evaluate(() => window.__officeDebug!.tags())).filter((t) => t.visible);
  expect(tags.length).toBeGreaterThan(30);
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    const a = tags[i], b = tags[j];
    expect(Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) < Math.max(a.h, b.h), `${a.slug} overlaps ${b.slug}`).toBe(false);
  }
  await shot("p08");
});

const API = "http://127.0.0.1:8000";
const nearestBot = async () => {
  const people = await page.evaluate(() => window.__officeDebug!.people());
  const me = people.find((p) => p.slug === "founder") ?? people[0];
  const bot = people.filter((p) => p.slug !== me.slug).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  return { me, bot };
};

test("[P09] wheel zoom stays within 0.5..3, Home re-follows, minimap recenters", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  await expect(page.locator('[data-testid="office2-minimap"]')).toBeVisible({ timeout: 15_000 });
  const box = (await page.locator('[data-testid="office2-host"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  const z = (await page.evaluate(() => window.__officeDebug!.camera())).zoom;
  expect(z).toBeLessThanOrEqual(3); expect(z).toBeGreaterThan(1);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => window.__officeDebug!.camera())).zoom).toBeGreaterThanOrEqual(0.5);
  await page.locator('[data-testid="office2-host"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Home");
  await page.waitForTimeout(600);
  await page.locator('[data-testid="office2-minimap"]').click({ position: { x: 20, y: 80 } });
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => window.__officeDebug!.camera())).x).toBeLessThan(900);
  await page.locator('[data-testid="office2-host"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Home");
  await page.waitForTimeout(800);
  expect((await page.evaluate(() => window.__officeDebug!.camera())).zoom).toBe(1);
  await shot("p09");
});

test("[P11] demo events move agents and the bubble stays glued to its avatar", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  await page.evaluate(() => {
    const seen: string[] = []; (window as unknown as { __seen: string[] }).__seen = seen;
    setInterval(() => {
      const d = window.__officeDebug!;
      for (const p of d.people()) {
        seen.push(`${p.slug}:${p.place}`);
        const b = d.bubbleOf(p.slug);
        if (b) { seen.push(`bubble:${p.slug}:${b.text}`); if (Math.abs(b.x - p.x) > 1.5) seen.push(`DETACHED:${p.slug}`); }
      }
    }, 50);
  });
  void fetch(`${API}/ws/demo`, { method: "POST" });
  await page.waitForTimeout(6000);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen).toContain("jasper:meeting");
  expect(seen).toContain("forge:tools");
  expect(seen.some((s) => s.startsWith("bubble:jasper:Planning"))).toBe(true);
  expect(seen.filter((s) => s.startsWith("DETACHED"))).toEqual([]);
  await shot("p11");
});

test("[P12/P13] chip appears next to a bot, disappears, and opens the DM in Team Chat", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const { me, bot } = await nearestBot();
  await page.evaluate(([s, x, y]) => window.__officeDebug!.walkTo(s as string, x as number, y as number), [me.slug, Math.floor(bot.x / 32), Math.floor(bot.y / 32)]);
  const chip = page.locator('[data-testid="office2-chip"]');
  await expect(chip).toBeVisible({ timeout: 40_000 });
  await shot("p12");
  const name = ((await chip.innerText()).match(/Talk to (\S+)/) ?? [])[1];
  await chip.click();
  await expect(page.locator('[data-testid="chat-panel"] header span.font-semibold').first()).toContainText(name.replace(/,$/, ""), { timeout: 15_000 });
  await openPanel("office2");
  await page.evaluate(([s]) => window.__officeDebug!.walkTo(s as string, 52, 9), [me.slug]);
  await expect(chip).toBeHidden({ timeout: 40_000 });
});

test("[P14] clicking an avatar opens its ID card with data from /card", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  await page.locator('[data-testid="office2-host"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Home");
  await page.waitForTimeout(1500);
  const { bot } = await nearestBot();
  const pos = (await page.evaluate(([s]) => window.__officeDebug!.screenOf(s as string), [bot.slug]))!;
  const responded = page.waitForResponse((r) => r.url().includes(`/api/v1/bots/${bot.slug}/card`) && r.status() === 200, { timeout: 15_000 });
  await page.mouse.click(pos.x, pos.y - 12);
  await responded;
  await expect(page.locator('[data-testid="office2-idcard"]')).toBeVisible();
  await shot("p14");
  await page.locator('[data-testid="office2-idcard"] button[aria-label="Close"]').click();
});

test("[P15] add an employee, see the avatar, clean up", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const before = await page.evaluate(() => window.__officePeople ?? 0);
  await page.getByRole("button", { name: /add employee/i }).click();
  await page.getByPlaceholder("Name").fill("E2E Test Bot");
  await page.getByPlaceholder("Role").fill("Tester");
  await shot("p15");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 25_000 }).toBe(before + 1);
  const card = await (await fetch(`${API}/api/v1/bots/e2e-test-bot/card`)).json();
  expect(card.role_title).toBe("Tester");
  await fetch(`${API}/api/v1/bots/e2e-test-bot`, { method: "DELETE" });
});

test("[P16] perf: 60 wandering avatars", async () => {
  await openPanel("office2", "?bots=60&wander=1");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 40_000 }).toBeGreaterThan(60);
  const run = async () => { const f: number[] = [], m: number[] = []; for (let i = 0; i < 15; i++) { await page.waitForTimeout(1000); f.push(await page.evaluate(() => window.__officeFps ?? 0)); m.push(await page.evaluate(() => window.__officeFrameMs ?? 0)); } f.sort((a, b) => a - b); return { fps: f[7], p95: Math.max(...m) }; };
  await page.waitForTimeout(8000);
  const z1 = await run();
  await page.locator('[data-testid="office2-host"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("+"); await page.keyboard.press("+");
  const z2 = await run();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, "perf.json"), JSON.stringify({ z1, z2 }));
  await shot("p16");
  expect(z1.fps).toBeGreaterThanOrEqual(55); expect(z2.fps).toBeGreaterThanOrEqual(55);
});

test("[P17] founder shows away (zzz) after the panel is hidden, and returns", async () => {
  await openPanel("office2", "?awayMs=1500");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const me = (await page.evaluate(() => window.__officeDebug!.people()))[0].slug;
  await page.evaluate((s) => {
    const seen: string[] = []; (window as unknown as { __zz: string[] }).__zz = seen;
    setInterval(() => { const b = window.__officeDebug?.bubbleOf(s); if (b) seen.push(b.text); }, 100);
  }, me);
  await page.waitForTimeout(1500);
  await openPanel("team_chat");
  await page.waitForTimeout(4500);
  await openPanel("office2", "?awayMs=1500");
  await page.waitForTimeout(2500);
  const seen = await page.evaluate(() => (window as unknown as { __zz: string[] }).__zz);
  expect(seen).toContain("zzz");
  expect(await page.evaluate((s) => window.__officeDebug!.bubbleOf(s), me)).toBeNull();
});
