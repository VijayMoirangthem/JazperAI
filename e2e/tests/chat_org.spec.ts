import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "jasper-chatorg-"))}`],
    env,
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  await page.evaluate(() => { location.hash = "team_chat"; });
  await page.waitForSelector("[data-testid=chat-panel]", { timeout: 60_000 });
}, 180_000);
test.afterAll(async () => { await app?.close(); });

test("bots are grouped into the Jazper Team and companies", async () => {
  for (const g of ["chief", "jazper_team", "create_origins", "baeit", "boardmint"]) await expect(page.getByTestId(`group-${g}`)).toBeVisible();
  await expect(page.getByTestId("chan-dm:messenger")).toBeVisible();
});

test("hovering a bot shows its position and department", async () => {
  await page.getByTestId("chan-dm:messenger").hover();
  const card = page.getByTestId("bot-hover-card");
  await expect(card).toContainText("Jazper Team");
  await expect(card).toContainText("Personal");
});

test("bot settings: ID card and prompt editor", async () => {
  await page.getByTestId("chan-dm:bot-reviewer").click();
  await page.getByTestId("customize-btn").click();
  await expect(page.getByTestId("id-card")).toContainText("bot-reviewer");
  await expect(page.getByTestId("id-card")).toContainText("Started working");
  await page.getByRole("button", { name: "Prompt" }).click();
  await expect(page.getByTestId("prompt-editor")).toHaveValue(/Bot Reviewer/);
  await page.getByRole("button", { name: "Close" }).click();
});

test("Jasper uses a tool and the chat shows a tool chip", async () => {
  await page.getByTestId("chan-dm:jasper").click();
  await page.getByLabel("Message", { exact: true }).fill("Use your tools to list the org and tell me how many groups exist.");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-chip").first()).toContainText("list_org", { timeout: 60_000 });
});
