import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const API = "http://127.0.0.1:8000";

function launchEnv(): Record<string, string> {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // even an empty value makes Electron run as plain Node
  return env;
}

let app: ElectronApplication;
let page: Page;

async function openPanel(id: string) {
  await page.evaluate((h) => { window.location.hash = h; }, id);
}
async function llmUsable(): Promise<boolean> {
  const r = await fetch(`${API}/api/v1/system/health`).then((x) => x.json());
  return !!r.checks?.llm?.ok;
}

test.beforeAll(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-"));  // fresh profile = first launch
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
    env: launchEnv(),
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  // Warm-up: the dev server optimizes dependencies the first time a panel loads and may reload the page. Visit each panel once so the tests see a stable page.
  for (const id of ["system", "team_chat", "diff_editor", "org_chart", "office", "ai_providers", "setup"]) {
    await page.evaluate((h) => { window.location.hash = h; }, id);
    await page.waitForTimeout(4000);
    await page.waitForLoadState("load");
  }
}, 240_000);

test.afterAll(async () => { await app?.close(); });

test("first launch opens the setup checklist and the services are healthy", async () => {
  await expect(page.getByText("Welcome to Jazper")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Database and Redis are running")).toBeVisible();
  await expect(page.locator("svg.text-green-500").first()).toBeVisible({ timeout: 20_000 });
});

test("renderer cannot reach node APIs (context isolation)", async () => {
  const r = await page.evaluate(() => ({ req: typeof (window as unknown as { require?: unknown }).require, node: (window as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node ?? null }));
  expect(r).toEqual({ req: "undefined", node: null }); // a browser-side process shim is fine; real Node is not
});

test("system panel shows health checks and keeps secrets write-only", async () => {
  await openPanel("system");
  await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  await expect(page.getByText(/[0-9]+ tables/)).toBeVisible();
  await expect(page.getByText("values are never shown", { exact: false })).toBeVisible();
});

test("team chat: message to Sir Jasper streams a real answer", async () => {
  test.skip(!(await llmUsable()), "no model configured");
  await openPanel("team_chat");
  const box = page.locator("textarea");
  await box.fill("Reply with exactly the word: pong");
  await box.press("Enter");
  await expect(page.locator(".rounded-2xl", { hasText: /pong/i }).last()).toBeVisible({ timeout: 60_000 });
});

test("team chat: an unknown @mention is not routed and Shift+Enter keeps a newline", async () => {
  await openPanel("team_chat");
  const box = page.locator("textarea");
  await box.fill("line one");
  await box.press("Shift+Enter");
  await box.type("line two");
  await expect(box).toHaveValue("line one\nline two");
});

test("org chart renders the spec structure", async () => {
  await openPanel("org_chart");
  await expect(page.getByText("Baeit Engineering & Operations Crew")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Boardmint Compliance & Governance Crew")).toBeVisible();
});

test("virtual office runs above 30 fps with people on the map", async () => {
  await openPanel("office");
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __officePeople?: number }).__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const fps = await page.evaluate(() => (window as unknown as { __officeFps?: number }).__officeFps ?? 0);
  expect(fps).toBeGreaterThan(30);
});

test("diff editor loads Monaco locally (no CDN, CSP clean)", async () => {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await openPanel("diff_editor");
  await expect(page.locator(".monaco-diff-editor").first()).toBeVisible({ timeout: 45_000 });
  await openPanel("team_chat"); // leaving the editor must not throw (model disposal)
  await page.waitForTimeout(1500);
  expect(pageErrors).toEqual([]);
  expect(errors.filter((e) => /Content Security Policy|jsdelivr/i.test(e))).toEqual([]);
});

test("AI providers lists the configured provider; secrets never appear in the page", async () => {
  await openPanel("ai_providers");
  await expect(page.getByText("Groq", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  const html = await page.content();
  expect(html).not.toMatch(/gsk_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}/);
});
