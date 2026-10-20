import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const RAIL = ["mind_map", "live_agents", "office", "org_chart", "dev_loop", "diff_editor", "connections", "skills", "mcp_hub", "ai_providers", "finops", "business", "system"];
let app: ElectronApplication;
let page: Page;
const errors: string[] = [];

test.beforeAll(async () => {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "jasper-speed-"))}`],
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  await page.evaluate(() => { location.hash = "team_chat"; });
  await page.waitForSelector("[data-testid=chat-panel]", { timeout: 60_000 });
}, 180_000);
test.afterAll(async () => { await app?.close(); });

test("every rail panel opens and has content within 4 s", async () => {
  for (const id of RAIL) {
    await page.getByTestId(`rail-${id}`).click();
    await expect(page.locator(`[data-keepalive=${id}]`)).toBeVisible({ timeout: 4000 });
    await expect.poll(async () => (await page.locator(`[data-keepalive=${id}]`).innerText()).trim().length, { timeout: 4000 }).toBeGreaterThan(20);
  }
  expect(errors).toEqual([]);
});

test("panels stay mounted: returning to a panel shows it immediately with no blocking load", async () => {
  await page.getByTestId("rail-office").click();
  await page.getByTestId("rail-skills").click();
  const t0 = Date.now();
  await page.getByTestId("rail-office").click();
  await expect(page.locator("[data-keepalive=office]")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(400);
  expect(await page.locator("[data-keepalive]").count()).toBeGreaterThan(5); // kept alive, not re-created
});

test("model picker pins a model for the active bot and Automatic resets it", async () => {
  await page.getByTestId("rail-team_chat").click();
  await page.getByTestId("chan-dm:scout").click();
  await page.getByTestId("model-pill").click();
  await page.getByTestId("model-menu").getByRole("button", { name: "qwen/qwen3.8-27b" }).first().click();
  await expect(page.getByTestId("model-pill")).toContainText("qwen3.8-27b");
  await page.getByTestId("model-pill").click();
  await page.getByTestId("model-menu").getByRole("button", { name: /Automatic/ }).click();
  await expect(page.getByTestId("model-pill")).toContainText("Auto");
});

test("office scene is not rebuilt by background polling", async () => {
  await page.getByTestId("rail-office").click();
  const canvas = page.locator("[data-keepalive=office] canvas").first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const handle = await canvas.elementHandle();
  await page.waitForTimeout(13_000); // longer than two roster polls (5 s)
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true); // same canvas: the Phaser game was not destroyed and recreated
});
