import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office 2 flows. Launch pattern copied from app.spec.ts (real Electron window). Each files prompt appends tests at the END of this file.
const root = path.resolve(__dirname, "../..");
const SHOTS = path.join(__dirname, "..", "test-results", "files");

declare global { interface Window { __officeFps?: number; __officePeople?: number; __filesStats?: { fps: number; calls: number; triangles: number; people: number; loadedMs: number } } }

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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-files-"));
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
    env: launchEnv(),
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  for (const id of ["team_chat", "files"]) {
    await page.evaluate((h) => { window.location.hash = h; }, id);
    await page.waitForTimeout(4000);
    await page.waitForLoadState("load");
  }
  consoleErrors.length = 0;
}, 240_000);

test.afterAll(async () => { await app?.close(); });


test("[files] a Drive Doc opens in the viewer tab", async () => {
  const r = await fetch("http://127.0.0.1:8000/api/v1/drive/files?q=Sir%20Jasper&limit=5").then((x) => x.json());
  const doc = r.files.find((f: { mimeType: string }) => f.mimeType.endsWith("document")) ?? r.files[0];
  await page.evaluate((f) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ id: f.id, name: f.name, mime: f.mimeType }], active: f.id })); }, doc);
  await page.reload();
  await page.waitForLoadState("load");
  await openPanel("files");
  await expect(page.locator('[data-testid="files-viewer"] iframe')).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1500);
  const len = await page.locator('[data-testid="files-viewer"] iframe').evaluate((el) => (el as HTMLIFrameElement).srcdoc.length);
  expect(len).toBeGreaterThan(1000);
  await shot("files-doc");
});
