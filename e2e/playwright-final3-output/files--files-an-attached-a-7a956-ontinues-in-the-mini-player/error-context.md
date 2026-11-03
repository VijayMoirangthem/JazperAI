# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files.spec.ts >> [files] an attached audio file opens and continues in the mini-player
- Location: tests\files.spec.ts:70:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /Keep playing/ })
Expected: visible
Timeout: 40000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: /Keep playing/ }) with timeout 40000ms
  - waiting for getByRole('button', { name: /Keep playing/ })

```

```yaml
- paragraph: Step 1 of 3
- heading "Welcome to Baeit POS" [level=1]
- paragraph: Setting up this device for the first time.
- term: Storage protection
- definition: On — data survives storage pressure
- term: Demo accounts
- definition: Ready — PIN 123456
- paragraph: Demo data only. Change every PIN and clear demo records before serving real customers.
- checkbox "I understand this is a pilot build and accept the Baeit POS Terms (draft). The full text is in Settings → Legal & About."
- text: I understand this is a pilot build and accept the Baeit POS Terms (draft). The full text is in Settings → Legal & About.
- button "Continue" [disabled]
- region "Notifications alt+T"
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
  40 |   // Electron can finish its first Vite navigation before firstWindow() resolves.
  41 |   // Poll the current URL rather than waiting for a navigation event that already happened.
  42 |   await expect.poll(() => page.url(), { timeout: 90_000 }).toMatch(/localhost:5173/);
  43 |   page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  44 |   // A fresh Electron profile may land on the local pilot setup gate before the
  45 |   // Jazper shell mounts. Complete its required acknowledgement for this test-only profile.
  46 |   const pilotGate = page.getByRole("checkbox", { name: /pilot build and accept/i });
  47 |   if (await pilotGate.isVisible().catch(() => false)) {
  48 |     await pilotGate.check();
  49 |     await page.getByRole("button", { name: "Continue" }).click();
  50 |     await page.waitForLoadState("load");
  51 |   }
  52 |   // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  53 |   for (const id of ["team_chat", "files"]) {
  54 |     await page.evaluate((h) => { window.location.hash = h; }, id);
  55 |     await page.waitForTimeout(4000);
  56 |     await page.waitForLoadState("load");
  57 |   }
  58 |   consoleErrors.length = 0;
  59 | }, 240_000);
  60 | 
  61 | test.afterAll(async () => { await app?.close(); });
  62 | 
  63 | 
  64 | test("[files] a Drive Doc opens in the viewer tab", async () => {
  65 |   const r = await fetch("http://127.0.0.1:8000/api/v1/drive/files?q=Sir%20Jasper&limit=5").then((x) => x.json());
  66 |   const doc = r.files.find((f: { mimeType: string }) => f.mimeType.endsWith("document")) ?? r.files[0];
  67 |   await page.evaluate((f) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "drive", id: f.id, name: f.name, mime: f.mimeType }], active: `drive:${f.id}` })); }, doc);
  68 |   await page.reload();
  69 |   await page.waitForLoadState("load");
  70 |   await openPanel("files");
  71 |   await expect(page.locator('[data-testid="files-viewer"] iframe')).toBeVisible({ timeout: 40_000 });
  72 |   await page.waitForTimeout(1500);
  73 |   const len = await page.locator('[data-testid="files-viewer"] iframe').evaluate((el) => (el as HTMLIFrameElement).srcdoc.length);
  74 |   expect(len).toBeGreaterThan(1000);
  75 |   await shot("files-doc");
  76 | });
  77 | 
  78 | test("[files] an attached audio file opens and continues in the mini-player", async () => {
  79 |   const bytes = fs.readFileSync(path.join(__dirname, "..", "fixtures", "speech.wav"));
  80 |   const form = new FormData();
  81 |   form.set("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
> 82 |   const uploaded = await fetch("http://127.0.0.1:8000/api/v1/files/upload", { method: "POST", body: form }).then(async response => {
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
  83 |     if (!response.ok) throw new Error(await response.text());
  84 |     return response.json() as Promise<{ id: string; name: string; mime: string; size: number; modified?: string }>;
  85 |   });
  86 |   await page.evaluate((file) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "attachment", ...file }], active: `attachment:${file.id}` })); }, uploaded);
  87 |   await page.reload();
  88 |   await page.waitForLoadState("load");
  89 |   await openPanel("files");
  90 |   await expect(page.getByRole("button", { name: /Keep playing/ })).toBeVisible({ timeout: 40_000 });
  91 |   await page.getByRole("button", { name: /Keep playing/ }).click();
  92 |   await expect(page.getByLabel("Close player")).toBeVisible();
  93 |   await shot("files-audio-mini-player");
  94 | });
  95 | 
```