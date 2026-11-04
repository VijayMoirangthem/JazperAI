// Preload: expose a minimal, typed bridge. No Node primitives reach the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jasper", {
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  pickFile: () => ipcRenderer.invoke("pick-file"),
  appInfo: () => ipcRenderer.invoke("app-info"),
  openFileWindow: (file) => ipcRenderer.invoke("open-file-window", file),
  openPath: (path) => ipcRenderer.invoke("open-path", path),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  savePng: (name, dataUrl) => ipcRenderer.invoke("save-png", { name, dataUrl }),
  revealSavedPng: (path) => ipcRenderer.invoke("reveal-saved-png", path),
  onDeepLink: (cb) => ipcRenderer.on("deep-link", (_e, link) => cb(String(link))),
});
