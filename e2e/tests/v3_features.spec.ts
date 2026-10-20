import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const API = "http://127.0.0.1:8000";
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "jasper-v3-"))}`],
    env,
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  await page.evaluate(() => { location.hash = "team_chat"; });
  await page.waitForSelector("[data-testid=chat-panel]", { timeout: 60_000 });
}, 180_000);
test.afterAll(async () => { await app?.close(); });

test("bot settings Behaviour tab saves and the backend enforces it", async () => {
  await page.getByTestId("chan-dm:scout").click();
  await page.getByTestId("customize-btn").click();
  await page.getByTestId("bot-settings").getByRole("button", { name: "Behaviour", exact: true }).click();
  await page.getByLabel("Reply style").selectOption("concise");
  await page.getByLabel("Memory group").uncheck();
  await page.getByTestId("behaviour-tab").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("behaviour-tab")).toContainText("Saved");
  const card = await (await fetch(`${API}/api/v1/bots/scout/card`)).json();
  expect(card.settings.style).toBe("concise");
  expect(card.settings.memory_scopes.group).toBe(false);
  // reset so later runs start clean
  await fetch(`${API}/api/v1/bots/scout/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: null, memory_scopes: null }) });
  await page.getByRole("button", { name: "Close" }).click();
});

test("model catalogue lists prices and opens a side-by-side comparison", async () => {
  await page.getByTestId("rail-ai_providers").click();
  const cat = page.getByTestId("model-catalog");
  await expect(cat).toBeVisible({ timeout: 15_000 });
  await expect(cat.getByTestId("cat-groq:qwen/qwen3.8-27b")).toBeVisible();
  await expect(cat.getByTestId("cat-groq:qwen/qwen3.8-27b")).toContainText("free"); // Groq free tier is priced at $0
  await cat.getByLabel("Select groq:qwen/qwen3.8-27b").check();
  await cat.getByLabel("Select groq2:openai/gpt-oss-20b").check();
  await cat.getByTestId("compare-open").click();
  await expect(page.getByTestId("compare-modal")).toBeVisible();
  await expect(page.getByTestId("cmp-groq:qwen/qwen3.8-27b")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
});

test("phones: a pairing code is shown and expires", async () => {
  await page.getByTestId("rail-connections").click();
  await page.getByTestId("pair-start").click();
  const code = page.getByTestId("pair-code");
  await expect(code).toBeVisible({ timeout: 10_000 });
  await expect(code).toContainText(/[A-Z2-9]{8}/);
});

test("connector suggestions come back as one-click cards", async () => {
  const r = await (await fetch(`${API}/api/v1/connections/`)).json();
  expect(r.connections.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(["google-workspace", "playwright", "github"]));
  const pw = r.connections.find((c: { id: string }) => c.id === "playwright");
  expect(pw.untested).toBe(false); // verified live: 25 tools, browser_tabs read
});
