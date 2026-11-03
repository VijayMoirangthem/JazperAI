import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import type { ViewerProps } from "../registry";
import { useFileViewer } from "@/stores/fileViewerStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const language = (name: string) => ({ py: "python", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", md: "markdown", yml: "yaml", yaml: "yaml", html: "html", css: "css", sql: "sql" }[name.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext");
export default function CodeViewer({ file, contentUrl }: ViewerProps) {
  const [value, setValue] = useState(""); const [editing, setEditing] = useState(false); const [status, setStatus] = useState(""); const draftKey = `jasper.file-draft:${file.src}:${file.id}`;
  useEffect(() => { const draft = localStorage.getItem(draftKey); if (draft != null) { setValue(draft); setStatus("Recovered local draft."); return; } fetch(contentUrl + "&mode=text").then(r => r.text()).then(setValue).catch(e => setStatus(String(e.message))); }, [contentUrl, draftKey]);
  useEffect(() => { if (editing) localStorage.setItem(draftKey, value); }, [draftKey, editing, value]);
  const save = async () => { setStatus("Saving — Jazper will ask for approval…"); const r = await fetch(`${API}/api/v1/files/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: file.src, id: file.id, text: value }) }); if (r.ok) { localStorage.removeItem(draftKey); useFileViewer.getState().setDirty(`${file.src}:${file.id}`, false); setStatus("Saved with backup."); } else setStatus(`Save blocked: ${await r.text()}`); };
  return <div className="flex h-full flex-col"><div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs"><button onClick={() => setEditing(!editing)} className="rounded bg-white/10 px-2 py-1">{editing ? "Read only" : "Edit"}</button>{editing && <button onClick={save} className="rounded bg-indigo-500 px-2 py-1">Save</button>}<span className="opacity-60">{status}</span></div><Editor height="100%" theme="vs-dark" language={language(file.name)} value={value} onChange={v => { setValue(v ?? ""); if (editing) useFileViewer.getState().setDirty(`${file.src}:${file.id}`, true); }} options={{ readOnly: !editing, minimap: { enabled: true }, automaticLayout: true, wordWrap: "on" }} /></div>;
}
