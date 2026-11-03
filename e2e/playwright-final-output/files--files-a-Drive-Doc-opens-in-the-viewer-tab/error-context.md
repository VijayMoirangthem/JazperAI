# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files.spec.ts >> [files] a Drive Doc opens in the viewer tab
- Location: tests\files.spec.ts:54:5

# Error details

```
TimeoutError: page.waitForURL: Timeout 90000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
  navigated to "http://localhost:5173/"
============================================================
```

# Test source

```ts
  1  | import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
  2  | import fs from "node:fs";
  3  | import os from "node:os";
  4  | import path from "node:path";
  5  | 
  6  | // Office 2 flows. Launch pattern copied from app.spec.ts (real Electron window). Each files prompt appends tests at the END of this file.
  7  | const root = path.resolve(__dirname, "../..");
  8  | // Defaults to the acceptance-artifact folder. A developer can override this
  9  | // for a concurrent/manual run without touching or deleting another run's output.
  10 | const SHOTS = process.env.JASPER_E2E_SHOTS || path.join(__dirname, "..", "test-results", "files");
  11 | 
  12 | declare global { interface Window { __officeFps?: number; __officePeople?: number; __filesStats?: { fps: number; calls: number; triangles: number; people: number; loadedMs: number } } }
  13 | 
  14 | function launchEnv(): Record<string, string> {
  15 |   const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  16 |   delete env.ELECTRON_RUN_AS_NODE; // even an empty value makes Electron run as plain Node
  17 |   return env;
  18 | }
  19 | 
  20 | let app: ElectronApplication;
  21 | let page: Page;
  22 | const consoleErrors: string[] = [];
  23 | 
  24 | async function openPanel(id: string, query = "") {
  25 |   await page.evaluate(([h, q]) => { window.location.hash = h + q; }, [id, query]);
  26 | }
  27 | async function shot(name: string) {
  28 |   fs.mkdirSync(SHOTS, { recursive: true });
  29 |   await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  30 | }
  31 | 
  32 | test.beforeAll(async () => {
  33 |   const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-files-"));
  34 |   app = await electron.launch({
  35 |     executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
  36 |     args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
  37 |     env: launchEnv(),
  38 |   });
  39 |   page = await app.firstWindow();
> 40 |   // Electron can finish its first Vite navigation before firstWindow() resolves.
     |              ^ TimeoutError: page.waitForURL: Timeout 90000ms exceeded.
  41 |   // Poll the current URL rather than waiting for a navigation event that already happened.
  42 |   await expect.poll(() => page.url(), { timeout: 90_000 }).toMatch(/localhost:5173/);
  43 |   page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  44 |   // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  45 |   for (const id of ["team_chat", "files"]) {
  46 |     await page.evaluate((h) => { window.location.hash = h; }, id);
  47 |     await page.waitForTimeout(4000);
  48 |     await page.waitForLoadState("load");
  49 |   }
  50 |   consoleErrors.length = 0;
  51 | }, 240_000);
  52 | 
  53 | test.afterAll(async () => { await app?.close(); });
  54 | 
  55 | 
  56 | test("[files] a Drive Doc opens in the viewer tab", async () => {
  57 |   const r = await fetch("http://127.0.0.1:8000/api/v1/drive/files?q=Sir%20Jasper&limit=5").then((x) => x.json());
  58 |   const doc = r.files.find((f: { mimeType: string }) => f.mimeType.endsWith("document")) ?? r.files[0];
  59 |   await page.evaluate((f) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "drive", id: f.id, name: f.name, mime: f.mimeType }], active: `drive:${f.id}` })); }, doc);
  60 |   await page.reload();
  61 |   await page.waitForLoadState("load");
  62 |   await openPanel("files");
  63 |   await expect(page.locator('[data-testid="files-viewer"] iframe')).toBeVisible({ timeout: 40_000 });
  64 |   await page.waitForTimeout(1500);
  65 |   const len = await page.locator('[data-testid="files-viewer"] iframe').evaluate((el) => (el as HTMLIFrameElement).srcdoc.length);
  66 |   expect(len).toBeGreaterThan(1000);
  67 |   await shot("files-doc");
  68 | });
  69 | 
  70 | test("[files] an attached audio file opens and continues in the mini-player", async () => {
  71 |   const bytes = fs.readFileSync(path.join(__dirname, "..", "fixtures", "speech.wav"));
  72 |   const form = new FormData();
  73 |   form.set("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
  74 |   const uploaded = await fetch("http://127.0.0.1:8000/api/v1/files/upload", { method: "POST", body: form }).then(async response => {
  75 |     if (!response.ok) throw new Error(await response.text());
  76 |     return response.json() as Promise<{ id: string; name: string; mime: string; size: number; modified?: string }>;
  77 |   });
  78 |   await page.evaluate((file) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "attachment", ...file }], active: `attachment:${file.id}` })); }, uploaded);
  79 |   await page.reload();
  80 |   await page.waitForLoadState("load");
  81 |   await openPanel("files");
  82 |   await expect(page.getByRole("button", { name: /Keep playing/ })).toBeVisible({ timeout: 40_000 });
  83 |   await page.getByRole("button", { name: /Keep playing/ }).click();
  84 |   await expect(page.getByLabel("Close player")).toBeVisible();
  85 |   await shot("files-audio-mini-player");
  86 | });
  87 | 
```