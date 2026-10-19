// Sir Jasper AI desktop shell (P3-02). Loads the existing UI (Next dev server for now; Vite renderer later, ADR D-4).
const { app, BrowserWindow, ipcMain, Notification, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const UI_URL = process.env.JASPER_UI_URL || "http://localhost:5173";
const API_URL = process.env.JASPER_API_URL || "http://localhost:8000";
const ROOT = path.resolve(__dirname, "..");
const SMOKE = process.argv.includes("--smoke");
const UI_CHECK = process.argv.includes("--ui-check");
const CHAT_CHECK = process.argv.includes("--chat-check");
const ALLOWED_ORIGINS = new Set([new URL(UI_URL).origin, new URL(API_URL).origin]);

let win = null;
let backend = null;

// ── single instance + deep link (jasper://… for OAuth loopback hand-off) ──────────────────
if (!app.requestSingleInstanceLock() && !SMOKE) app.quit();
app.setAsDefaultProtocolClient("jasper");
app.on("second-instance", (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const link = argv.find((a) => a.startsWith("jasper://"));
  if (link && win) win.webContents.send("deep-link", link);
});

// ── backend supervision: start uvicorn if the API is not already up, stop it on quit ─────
function ping(url) {
  return new Promise((resolve) => {
    http.get(url, (r) => { r.resume(); resolve(r.statusCode < 500); }).on("error", () => resolve(false));
  });
}

async function ensureBackend() {
  if (await ping(`${API_URL}/health/`)) return;
  const py = path.join(ROOT, "backend", ".venv", "Scripts", "python.exe");
  backend = spawn(py, ["-m", "uvicorn", "main:app", "--port", new URL(API_URL).port || "8000"], {
    cwd: path.join(ROOT, "backend", "python"), stdio: "ignore", windowsHide: true,
  });
  backend.on("exit", () => { backend = null; });
  for (let i = 0; i < 60; i++) { if (await ping(`${API_URL}/health/`)) return; await new Promise((r) => setTimeout(r, 1000)); }
}

// ── window ──────────────────────────────────────────────────────────────────────────────
function createWindow(url) {
  win = new BrowserWindow({
    width: 1440, height: 900, show: !SMOKE, backgroundColor: "#0b0f14", title: "Sir Jasper AI",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//.test(u)) shell.openExternal(u); // external links open in the system browser
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, u) => {
    if (!u.startsWith("data:") && !ALLOWED_ORIGINS.has(new URL(u).origin)) e.preventDefault();
  });
  return win.loadURL(url);
}

// ── typed IPC allow-list (the only things the renderer may ask the main process to do) ──────
ipcMain.handle("notify", (_e, { title, body }) => {
  if (typeof title === "string" && Notification.isSupported()) new Notification({ title: title.slice(0, 80), body: String(body || "").slice(0, 300) }).show();
});
ipcMain.handle("pick-file", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("app-info", () => ({ version: app.getVersion(), api: API_URL, platform: process.platform }));

app.whenReady().then(async () => {
  // strict CSP for the UI origin (dev server needs inline/eval for HMR; tightened when the static Vite renderer lands)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const h = { ...details.responseHeaders };
    h["Content-Security-Policy"] = [`default-src 'self' ${UI_URL} ${API_URL} ws://localhost:8000 data: blob:; ` +
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${UI_URL}; style-src 'self' 'unsafe-inline' ${UI_URL} https://fonts.googleapis.com; ` +
      `font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' ${API_URL} ws://localhost:8000 ${UI_URL} ws://localhost:3001`];
    cb({ responseHeaders: h });
  });

  if (SMOKE) {
    // security smoke test: renderer must not see node primitives, and the preload bridge must expose only the allow-list
    await createWindow("data:text/html,<title>smoke</title><body>ok");
    const r = await win.webContents.executeJavaScript(
      "JSON.stringify({require: typeof require, process: typeof process, bridge: Object.keys(window.jasper||{}).sort()})");
    console.log("SMOKE_RESULT " + r);
    app.exit(0);
    return;
  }
  await ensureBackend();
  if (CHAT_CHECK) {
    const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    w.webContents.on("console-message", (_e, level, message) => { if (level >= 3) console.log("CONSOLE_ERR " + message.slice(0, 300)); });
    w.setSize(1280, 860);
    await w.loadURL(UI_URL + "#team_chat");
    await new Promise((r) => setTimeout(r, 4000));
    const script = `(async () => {
      const ta = document.querySelector('textarea');
      if (!ta) return 'NO_TEXTAREA';
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, 'Reply with exactly the word: pong'); ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 15000));
      const el = document.querySelector('.rounded-2xl');
      const hits = [];
      const walk = (rules, layer) => { for (const r of rules) { if (r.cssRules && !r.selectorText) walk(r.cssRules, (r.name || r.constructor.name) + '/' + layer); else if (r.selectorText && (r.style.padding || r.style.paddingInline) ) { try { if (el.matches(r.selectorText)) hits.push(layer + ' ' + r.selectorText + ' => ' + (r.style.padding || r.style.paddingInline)); } catch (e) {} } } };
      for (const sh of document.styleSheets) { try { walk(sh.cssRules, 'top'); } catch (e) {} }
      return 'PADHITS ' + hits.join(' ;; ') + ' computed=' + getComputedStyle(el).padding + ' cls=' + el.className;
      return 'ta=' + document.querySelectorAll('textarea').length + ' bubbles=' + document.querySelectorAll('.rounded-2xl').length + ' text=' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 400);
    })()`;
    console.log("CHAT_CHECK " + (await w.webContents.executeJavaScript(script)));
    require("node:fs").writeFileSync(process.env.JASPER_SHOT || "shot.png", (await w.webContents.capturePage()).toPNG());
    app.exit(0);
    return;
  }
  if (UI_CHECK) {
    const panels = (process.env.JASPER_PANELS || "dashboard").split(",");
    const w = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { contextIsolation: true, sandbox: true } });
    let errors = [];
    w.webContents.on("console-message", (_e, level, message) => { if (level >= 3) errors.push(message.slice(0, 140)); });
    for (const p of panels) {
      errors = [];
      await w.loadURL(UI_URL + "#" + p);
      await new Promise((r) => setTimeout(r, 3500));
      const info = await w.webContents.executeJavaScript("JSON.stringify({title: document.title, len: document.body.innerText.length})");
      console.log("UI_CHECK " + p + " " + info + " errors=" + JSON.stringify(errors.slice(0, 3)));
    }
    app.exit(0);
    return;
  }
  await createWindow(UI_URL);
});

app.on("before-quit", () => { if (backend) backend.kill(); });
app.on("window-all-closed", () => app.quit());
