import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const wav = path.join(__dirname, "../fixtures/speech.wav");

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [
      path.join(root, "desktop"), `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "jasper-voice-"))}`,
      // a spoken sentence ("Hello Jasper. Please reply with exactly the word pong.") plays as the microphone
      "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
    env,
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  await page.evaluate(() => { location.hash = "team_chat"; });
  await page.waitForTimeout(6000);
}, 180_000);

test.afterAll(async () => { await app?.close(); });

test("hands-free voice: speech is detected, transcribed, answered and spoken back; latency is measured", async () => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.getByRole("button", { name: /^Voice$/ }).click();
  await expect(page.getByRole("button", { name: /listening|transcribing/ })).toBeVisible({ timeout: 60_000 });
  // the user's utterance appears as a message, transcribed from the audio (not typed)
  await expect(page.locator(".rounded-2xl", { hasText: /pong/i }).first()).toBeVisible({ timeout: 90_000 });
  // the reply is spoken: the speaker reports its first audio and the latency breakdown is recorded
  const lat = await page.waitForFunction(() => (window as unknown as { __voiceLatency?: unknown }).__voiceLatency, null, { timeout: 90_000 }).then((h) => h.jsonValue()) as
    { stt_ms: number; llm_first_token_ms: number; tts_first_audio_ms: number; total_ms: number };
  console.log("VOICE LATENCY (ms):", JSON.stringify(lat));
  expect(lat.total_ms).toBeGreaterThan(0);
  expect(lat.total_ms).toBeLessThan(15_000);
  expect(errors.filter((e) => !/AbortError/.test(e))).toEqual([]);
});
