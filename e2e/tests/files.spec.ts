import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office 2 flows. Launch pattern copied from app.spec.ts (real Electron window). Each files prompt appends tests at the END of this file.
const root = path.resolve(__dirname, "../..");
const UI_URL = process.env.JASPER_E2E_UI_URL || "http://localhost:5173/";
// Defaults to the acceptance-artifact folder. A developer can override this
// for a concurrent/manual run without touching or deleting another run's output.
const SHOTS = process.env.JASPER_E2E_SHOTS || path.join(__dirname, "..", "test-results", "files");

declare global { interface Window { __officeFps?: number; __officePeople?: number; __filesStats?: { fps: number; calls: number; triangles: number; people: number; loadedMs: number } } }

function launchEnv(): Record<string, string> {
  const env = { ...process.env, JASPER_E2E: "1", JASPER_UI_URL: UI_URL } as Record<string, string>;
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
  // Electron can finish its first Vite navigation before firstWindow() resolves.
  // Poll the current URL rather than waiting for a navigation event that already happened.
  await expect.poll(() => page.url(), { timeout: 90_000 }).toContain(new URL(UI_URL).host);
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
  await page.evaluate((f) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "drive", id: f.id, name: f.name, mime: f.mimeType }], active: `drive:${f.id}` })); }, doc);
  await page.reload();
  await page.waitForLoadState("load");
  await openPanel("files");
  const viewer = page.locator('[data-testid="files-viewer"]');
  await expect(viewer.getByRole("button", { name: /Edit in Jazper/ })).toBeVisible({ timeout: 40_000 }); // HtmlViewer: sanitized Google Doc export
  const frame = viewer.locator("iframe");
  await expect(frame).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => frame.evaluate((el) => (el as HTMLIFrameElement).srcdoc.length), { timeout: 20_000 }).toBeGreaterThan(1000);
  await shot("files-doc");
});

test("[files] an attached audio file opens and continues in the mini-player", async () => {
  const bytes = fs.readFileSync(path.join(__dirname, "..", "fixtures", "speech.wav"));
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
  const uploaded = await fetch("http://127.0.0.1:8000/api/v1/files/upload", { method: "POST", body: form }).then(async response => {
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ id: string; name: string; mime: string; size: number; modified?: string }>;
  });
  await page.evaluate((file) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "attachment", ...file }], active: `attachment:${file.id}` })); }, uploaded);
  await page.reload();
  await page.waitForLoadState("load");
  await openPanel("files");
  await expect(page.getByRole("button", { name: /Keep playing/ })).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: /Keep playing/ }).click();
  await expect(page.getByLabel("Close player")).toBeVisible();
  await shot("files-audio-mini-player");
});
