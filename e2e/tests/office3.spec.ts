import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office 2 flows. Launch pattern copied from app.spec.ts (real Electron window). Each office3 prompt appends tests at the END of this file.
const root = path.resolve(__dirname, "../..");
const SHOTS = path.join(__dirname, "..", "test-results", "office3");

declare global { interface Window { __officeFps?: number; __officePeople?: number; __office3Stats?: { fps: number; calls: number; triangles: number; people: number; loadedMs: number } } }

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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-office3-"));
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
    env: launchEnv(),
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  for (const id of ["team_chat", "office3"]) {
    await page.evaluate((h) => { window.location.hash = h; }, id);
    await page.waitForTimeout(4000);
    await page.waitForLoadState("load");
  }
  consoleErrors.length = 0;
}, 240_000);

test.afterAll(async () => { await app?.close(); });


test("[O3] real roster renders in 3D", async () => {
  await openPanel("office3");
  await expect(page.locator('[data-testid="office3-host"] canvas').first()).toBeAttached({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 60_000 }).toBeGreaterThan(40);
  await page.waitForTimeout(6000);
  await shot("o3-roster");
  const st = await page.evaluate(() => window.__office3Stats);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, "o3-roster.json"), JSON.stringify(st));
  expect(consoleErrors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});

test("[O3] 60 wandering people: fps", async () => {
  await openPanel("office3", "?bots=60&wander=1");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 90_000 }).toBeGreaterThan(100);
  await page.waitForTimeout(8000);
  const f: number[] = [];
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(1000); f.push(await page.evaluate(() => window.__officeFps ?? 0)); }
  f.sort((a, b) => a - b);
  await shot("o3-crowd");
  fs.writeFileSync(path.join(SHOTS, "o3-crowd.json"), JSON.stringify({ medianFps: f[6], min: f[0], stats: await page.evaluate(() => window.__office3Stats) }));
});
