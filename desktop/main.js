// Sir Jasper AI desktop shell (P3-02). Loads the existing UI (Next dev server for now; Vite renderer later, ADR D-4).
const { app, BrowserWindow, ipcMain, Notification, dialog, session, shell, Tray, Menu, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const API_URL = process.env.JASPER_API_URL || "http://127.0.0.1:8000";
const PROD = process.env.JASPER_MODE === "prod"; // built UI served by the backend (no dev server)
const UI_URL = process.env.JASPER_UI_URL || (PROD ? API_URL + "/ui/" : "http://localhost:5173");
const ROOT = path.resolve(__dirname, "..");
const SMOKE = process.argv.includes("--smoke");
const UI_CHECK = process.argv.includes("--ui-check");
const CHAT_CHECK = process.argv.includes("--chat-check");
const OFFICE_CHECK = process.argv.includes("--office-check");
const ALLOWED_ORIGINS = new Set([new URL(UI_URL).origin, new URL(API_URL).origin]);

let win = null;
let backend = null;

// ── single instance + deep link (jasper://… for OAuth loopback hand-off) ──────────────────
const E2E = !!process.env.JASPER_E2E; // automated tests run their own instance
if (!E2E && !app.requestSingleInstanceLock() && !SMOKE) app.quit();
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
  if (process.env.JASPER_LAUNCHER) { await waitFor(`${API_URL}/health/`, 300); return; } // Jazper.exe owns the services; just wait for them
  const py = path.join(ROOT, "backend", ".venv", "Scripts", "python.exe");
  backend = spawn(py, ["run_server.py", "--port", new URL(API_URL).port || "8000"], {
    cwd: path.join(ROOT, "backend", "python"), stdio: "ignore", windowsHide: true,
  });
  backend.on("exit", () => { backend = null; });
  for (let i = 0; i < 60; i++) { if (await ping(`${API_URL}/health/`)) return; await new Promise((r) => setTimeout(r, 1000)); }
}

// ── window ──────────────────────────────────────────────────────────────────────────────
const SPLASH = "<body style='margin:0;background:#0b0f14;color:#cbd5e1;font:15px Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:14px'>" +
  "<div style='width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#6366f1,#a855f7);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:30px;color:#fff'>JZ</div>" +
  "<div>Starting Sir Jasper AI…</div><div id=m style='opacity:.5;font-size:12px'>database, backend, interface (after code changes the first start rebuilds the interface and can take a couple of minutes)</div></body>";

let tray = null;
function setupTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  const show = () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };
  tray.setToolTip("Jazper");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Jazper", click: show },
    // the login item starts Jazper.exe, which brings up Docker, the backend and the interface before the window
    { label: "Start with Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, path: path.join(ROOT, "Jazper.exe") }) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.on("click", show);
}

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) { if (await ping(url)) return true; await new Promise((r) => setTimeout(r, 1000)); }
  return false;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1440, height: 900, show: !SMOKE, backgroundColor: "#0b0f14", title: "Sir Jasper AI", icon: path.join(__dirname, "icon.png"),
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
  if (OFFICE_CHECK) {
    const w = new BrowserWindow({ show: true, x: 40, y: 40, width: 1400, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
    w.webContents.on("console-message", (_e, level, message) => { if (level >= 3) console.log("CONSOLE_ERR " + message.slice(0, 200)); });
    await w.loadURL(UI_URL + "#" + (process.env.JASPER_HASH || "office"));
    await new Promise((r) => setTimeout(r, 6000));
    await w.webContents.executeJavaScript("fetch('http://localhost:8000/ws/demo',{method:'POST'})");
    await new Promise((r) => setTimeout(r, 4500));
    console.log("OFFICE_CHECK " + (await w.webContents.executeJavaScript("new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(JSON.stringify({ rafFps: Math.round(n / 3), gameFps: window.__officeFps, people: window.__officePeople, canvases: document.querySelectorAll('canvas').length })); }; requestAnimationFrame(tick); })")));
    require("node:fs").writeFileSync(process.env.JASPER_SHOT || "office.png", (await w.webContents.capturePage()).toPNG());
    app.exit(0);
    return;
  }
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
      if (p === "office") {
        await w.webContents.executeJavaScript("fetch('http://localhost:8000/ws/demo',{method:'POST'})");
        await new Promise((r) => setTimeout(r, 6000));
      }
      if (process.env.JASPER_SHOTDIR) require("node:fs").writeFileSync(require("node:path").join(process.env.JASPER_SHOTDIR, p + ".png"), (await w.webContents.capturePage()).toPNG());
      const info = await w.webContents.executeJavaScript("JSON.stringify({title: document.title, len: document.body.innerText.length, fps: window.__officeFps, people: window.__officePeople})");
      console.log("UI_CHECK " + p + " " + info + " errors=" + JSON.stringify(errors.slice(0, 3)));
    }
    app.exit(0);
    return;
  }
  await createWindow("data:text/html;charset=utf-8," + encodeURIComponent(SPLASH));
  if (!E2E) setupTray();
  await ensureBackend();
  if (await waitFor(UI_URL, 180)) await win.loadURL(UI_URL);
  else await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent("<body style='background:#0b0f14;color:#f87171;font:15px Segoe UI;padding:40px'>The interface did not start. Check storage/logs/renderer.err.log, then reopen the app.</body>"));
});

app.on("before-quit", () => { if (backend) backend.kill(); });
app.on("window-all-closed", () => app.quit());
