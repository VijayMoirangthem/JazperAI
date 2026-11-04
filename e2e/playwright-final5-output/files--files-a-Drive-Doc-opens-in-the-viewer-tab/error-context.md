# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files.spec.ts >> [files] a Drive Doc opens in the viewer tab
- Location: tests\files.spec.ts:57:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="files-viewer"] iframe')
Expected: visible
Timeout: 40000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('[data-testid="files-viewer"] iframe') with timeout 40000ms
  - waiting for locator('[data-testid="files-viewer"] iframe')

```

```yaml
- button "Quick Actions (New task, email, contact, focus)"
- navigation:
  - text: JZ
  - button "Chat"
  - button "Mind Map"
  - button "Live Agents"
  - button "Office 2 — WorkAdventure (beta)"
  - button "Office 3D — DeskRPG (beta)"
  - button "Files"
  - button "Org Chart"
  - button "Dev Loop"
  - button "AI Diff Editor"
  - button "Connections"
  - button "Skills"
  - button "Tool Hub"
  - button "AI Providers"
  - button "FinOps"
  - button "Business"
  - button "System"
  - button "Setup"
  - button "Legacy — previous version panels"
  - button "Roadmap"
  - button "Settings"
  - text: VJ
- banner:
  - text: Sir Jazper OS — Files 0 / 131.1k Offline
  - button "Enable Voice Conversation Mode (Ctrl+Shift+V)"
  - button "Toggle Studio Mode": Studio
  - button "Command Center": HQ
  - button "Toggle theme": Light
  - text: K
- complementary:
  - button "All files"
  - button "drive"
  - button "This PC"
  - button "attachment"
  - button "storage"
  - button "Link"
  - button "Recent"
  - button "Starred"
  - navigation "Folder breadcrumb":
    - button "Files"
  - textbox "Search drive"
  - text: Upload
  - combobox "Sort files":
    - option "Name" [selected]
    - option "Modified"
    - option "Size"
  - combobox "Filter file type":
    - option "All types" [selected]
    - option "Docs"
    - option "Sheets"
    - option "PDFs"
    - option "Images"
    - option "Audio"
    - option "Video"
    - option "Text/code"
    - option "Other"
  - button "List view"
  - button "Grid view"
  - text: Failed to fetch
- button "Sir Jasper AI"
- button "Close Sir Jasper AI"
- button "☆ Star"
- button "Rename"
- button "Copy"
- button "Move"
- button "Share"
- button "Trash"
- group: Ask Jazper
- button "Pop out"
- text: "Could not load Sir Jasper AI: TypeError: Failed to fetch"
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
  8  | const UI_URL = process.env.JASPER_E2E_UI_URL || "http://localhost:5173/";
  9  | // Defaults to the acceptance-artifact folder. A developer can override this
  10 | // for a concurrent/manual run without touching or deleting another run's output.
  11 | const SHOTS = process.env.JASPER_E2E_SHOTS || path.join(__dirname, "..", "test-results", "files");
  12 | 
  13 | declare global { interface Window { __officeFps?: number; __officePeople?: number; __filesStats?: { fps: number; calls: number; triangles: number; people: number; loadedMs: number } } }
  14 | 
  15 | function launchEnv(): Record<string, string> {
  16 |   const env = { ...process.env, JASPER_E2E: "1", JASPER_UI_URL: UI_URL } as Record<string, string>;
  17 |   delete env.ELECTRON_RUN_AS_NODE; // even an empty value makes Electron run as plain Node
  18 |   return env;
  19 | }
  20 | 
  21 | let app: ElectronApplication;
  22 | let page: Page;
  23 | const consoleErrors: string[] = [];
  24 | 
  25 | async function openPanel(id: string, query = "") {
  26 |   await page.evaluate(([h, q]) => { window.location.hash = h + q; }, [id, query]);
  27 | }
  28 | async function shot(name: string) {
  29 |   fs.mkdirSync(SHOTS, { recursive: true });
  30 |   await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  31 | }
  32 | 
  33 | test.beforeAll(async () => {
  34 |   const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-files-"));
  35 |   app = await electron.launch({
  36 |     executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
  37 |     args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
  38 |     env: launchEnv(),
  39 |   });
  40 |   page = await app.firstWindow();
  41 |   // Electron can finish its first Vite navigation before firstWindow() resolves.
  42 |   // Poll the current URL rather than waiting for a navigation event that already happened.
  43 |   await expect.poll(() => page.url(), { timeout: 90_000 }).toContain(new URL(UI_URL).host);
  44 |   page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  45 |   // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  46 |   for (const id of ["team_chat", "files"]) {
  47 |     await page.evaluate((h) => { window.location.hash = h; }, id);
  48 |     await page.waitForTimeout(4000);
  49 |     await page.waitForLoadState("load");
  50 |   }
  51 |   consoleErrors.length = 0;
  52 | }, 240_000);
  53 | 
  54 | test.afterAll(async () => { await app?.close(); });
  55 | 
  56 | 
  57 | test("[files] a Drive Doc opens in the viewer tab", async () => {
  58 |   const r = await fetch("http://127.0.0.1:8000/api/v1/drive/files?q=Sir%20Jasper&limit=5").then((x) => x.json());
  59 |   const doc = r.files.find((f: { mimeType: string }) => f.mimeType.endsWith("document")) ?? r.files[0];
  60 |   await page.evaluate((f) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "drive", id: f.id, name: f.name, mime: f.mimeType }], active: `drive:${f.id}` })); }, doc);
  61 |   await page.reload();
  62 |   await page.waitForLoadState("load");
  63 |   await openPanel("files");
> 64 |   await expect(page.locator('[data-testid="files-viewer"] iframe')).toBeVisible({ timeout: 40_000 });
     |                                                                     ^ Error: expect(locator).toBeVisible() failed
  65 |   await page.waitForTimeout(1500);
  66 |   const len = await page.locator('[data-testid="files-viewer"] iframe').evaluate((el) => (el as HTMLIFrameElement).srcdoc.length);
  67 |   expect(len).toBeGreaterThan(1000);
  68 |   await shot("files-doc");
  69 | });
  70 | 
  71 | test("[files] an attached audio file opens and continues in the mini-player", async () => {
  72 |   const bytes = fs.readFileSync(path.join(__dirname, "..", "fixtures", "speech.wav"));
  73 |   const form = new FormData();
  74 |   form.set("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
  75 |   const uploaded = await fetch("http://127.0.0.1:8000/api/v1/files/upload", { method: "POST", body: form }).then(async response => {
  76 |     if (!response.ok) throw new Error(await response.text());
  77 |     return response.json() as Promise<{ id: string; name: string; mime: string; size: number; modified?: string }>;
  78 |   });
  79 |   await page.evaluate((file) => { localStorage.setItem("jasper.viewer.tabs.v1", JSON.stringify({ tabs: [{ src: "attachment", ...file }], active: `attachment:${file.id}` })); }, uploaded);
  80 |   await page.reload();
  81 |   await page.waitForLoadState("load");
  82 |   await openPanel("files");
  83 |   await expect(page.getByRole("button", { name: /Keep playing/ })).toBeVisible({ timeout: 40_000 });
  84 |   await page.getByRole("button", { name: /Keep playing/ }).click();
  85 |   await expect(page.getByLabel("Close player")).toBeVisible();
  86 |   await shot("files-audio-mini-player");
  87 | });
  88 | 
```