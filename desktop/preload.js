// Preload: expose a minimal, typed bridge. No Node primitives reach the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jasper", {
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  pickFile: () => ipcRenderer.invoke("pick-file"),
  appInfo: () => ipcRenderer.invoke("app-info"),
  onDeepLink: (cb) => ipcRenderer.on("deep-link", (_e, link) => cb(String(link))),
});
