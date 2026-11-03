import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ViewerProps } from "../registry";
import { useFileViewer } from "@/stores/fileViewerStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
export default function MarkdownViewer({ file, contentUrl }: ViewerProps) {
  const [html, setHtml] = useState(""); const [source, setSource] = useState(""); const [editing, setEditing] = useState(false); const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let on = true; fetch(contentUrl).then(r => r.ok ? r.text() : Promise.reject(new Error(r.statusText))).then(s => on && setSource(s)).catch(e => on && setError(String(e.message))); return () => { on = false; }; }, [contentUrl]);
  useEffect(() => { let on = true; void Promise.resolve(marked.parse(source)).then(s => on && setHtml(DOMPurify.sanitize(String(s), { USE_PROFILES: { html: true } }))); return () => { on = false; }; }, [source]);
  useEffect(() => { if (editing) localStorage.setItem(`jasper.file-draft:${file.src}:${file.id}`, source); }, [editing, file.id, file.src, source]);
  const save = async () => { setStatus("Waiting for save approval…"); const r = await fetch(`${API}/api/v1/files/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: file.src, id: file.id, text: source }) }); setStatus(r.ok ? "Saved with backup." : `Save blocked: ${await r.text()}`); if (r.ok) { useFileViewer.getState().setDirty(`${file.src}:${file.id}`, false); setEditing(false); } };
  return error ? <div className="p-4 text-red-300">{error}</div> : <div className="flex h-full flex-col"><div className="flex gap-2 border-b border-white/10 px-3 py-2 text-xs"><button className="rounded bg-white/10 px-2 py-1" onClick={() => setEditing(v => !v)}>{editing ? "Preview" : "Edit"}</button>{editing && <button className="rounded bg-indigo-600 px-2 py-1" onClick={() => void save()}>Save</button>}<span className="opacity-60">{status}</span></div>{editing ? <textarea aria-label="Markdown editor" className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm outline-none" value={source} onChange={e => { setSource(e.target.value); useFileViewer.getState().setDirty(`${file.src}:${file.id}`, true); }} /> : <article className="prose prose-invert max-w-none flex-1 overflow-auto p-6 text-sm" dangerouslySetInnerHTML={{ __html: html }} />}</div>;
}
