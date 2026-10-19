import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default async function globalTeardown() {
  const pidFile = path.join(__dirname, ".started-pids.json");
  if (!fs.existsSync(pidFile)) return;
  for (const pid of JSON.parse(fs.readFileSync(pidFile, "utf8")) as number[]) {
    try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* already gone */ }
  }
  fs.unlinkSync(pidFile);
}
