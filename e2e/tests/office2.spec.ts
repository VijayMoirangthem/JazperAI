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
  await page.waitForTimeout(1500);
  const tags = (await page.evaluate(() => window.__officeDebug!.tags())).filter((t) => t.visible);
  expect(tags.length).toBeGreaterThan(30);
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    const a = tags[i], b = tags[j];
    expect(Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) < Math.max(a.h, b.h), `${a.slug} overlaps ${b.slug}`).toBe(false);
  }
  await shot("p08");
});
