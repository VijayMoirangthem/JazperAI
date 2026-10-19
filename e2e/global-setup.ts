import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const pidFile = path.join(__dirname, ".started-pids.json");

async function up(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).status < 500; } catch { return false; }
}
async function waitFor(url: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) { if (await up(url)) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`${url} did not come up in ${seconds}s`);
}

export default async function globalSetup() {
  const started: number[] = [];
  const launch = (cmd: string, args: string[], cwd: string): ChildProcess => {
    const p = spawn(cmd, args, { cwd, stdio: "ignore", windowsHide: true, shell: cmd.endsWith(".cmd") });
    p.unref();
    started.push(p.pid!);
    return p;
  };
  if (!(await up("http://127.0.0.1:8000/health/"))) launch(path.join(root, "backend/.venv/Scripts/python.exe"), ["run_server.py"], path.join(root, "backend/python"));
  if (!(await up("http://localhost:5173/"))) launch("npm.cmd", ["run", "dev"], path.join(root, "app"));
  await waitFor("http://127.0.0.1:8000/health/", 150);
  await waitFor("http://localhost:5173/", 90);
  fs.writeFileSync(pidFile, JSON.stringify(started));
}
