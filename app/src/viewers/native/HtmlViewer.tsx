import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ViewerProps } from "../registry";
import { useFileViewer } from "@/stores/fileViewerStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Google exports are untrusted HTML: sandbox denies scripts, same-origin access and popups. */
export default function HtmlViewer({ file, contentUrl }: ViewerProps) {
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [baseline, setBaseline] = useState("");
  const [review, setReview] = useState(false);
  const draftKey = `jasper.file-draft:${file.src}:${file.id}`;
  const editor = useEditor({ extensions: [StarterKit], content: "", editable: false, editorProps: { attributes: { class: "min-h-full max-w-3xl mx-auto p-6 outline-none prose prose-slate" } } });
  useEffect(() => { let live = true; fetch(contentUrl).then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.text(); }).then((v) => live && setHtml(v)).catch((e) => live && setError(String(e))); return () => { live = false; }; }, [contentUrl]);
  useEffect(() => { if (editing) localStorage.setItem(draftKey, draft); }, [draft, draftKey, editing]);
  useEffect(() => { editor?.setEditable(editing); }, [editing, editor]);
  useEffect(() => { if (!editor || !editing) return; const changed = () => { setDraft(editor.getText()); localStorage.setItem(draftKey, editor.getHTML()); useFileViewer.getState().setDirty(`${file.src}:${file.id}`, true); }; editor.on("update", changed); return () => { editor.off("update", changed); }; }, [draftKey, editing, editor, file.id, file.src]);
  const startEdit = () => { if (!editor) return; const saved = localStorage.getItem(draftKey); editor.commands.setContent(saved ?? html); const text = editor.getText(); setDraft(text); setBaseline(text); setStatus(saved ? "Recovered local draft." : "Editing locally. Save requests approval."); setEditing(true); };
  const save = async () => { const text = editor?.getText() ?? draft; setReview(false); setStatus("Waiting for approval…"); const r = await fetch(`${API}/api/v1/files/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: file.src, id: file.id, text }) }); setStatus(r.ok ? "Saved; Jazper changed this file." : `Save blocked: ${await r.text()}`); if (r.ok) { localStorage.removeItem(draftKey); useFileViewer.getState().setDirty(`${file.src}:${file.id}`, false); setEditing(false); setHtml(`<pre>${escapeHtml(text)}</pre>`); } };
  const change = (() => { const text = editor?.getText() ?? draft; let start = 0; while (start < baseline.length && start < text.length && baseline[start] === text[start]) start++; let end = 0; while (end < baseline.length - start && end < text.length - start && baseline[baseline.length - 1 - end] === text[text.length - 1 - end]) end++; return { removed: baseline.slice(start, baseline.length - end), added: text.slice(start, text.length - end) }; })();
  if (error) return <div className="p-4 text-sm text-red-300">Could not load {file.name}: {error}</div>;
  if (!html) return <div className="p-4 text-sm opacity-60">Loading document…</div>;
  if (editing) return <div className="relative flex h-full flex-col bg-white text-black"><div className="flex flex-wrap gap-2 border-b p-2 text-xs"><button className="rounded bg-indigo-600 px-3 py-1 text-white" onClick={() => setReview(true)}>Review &amp; save</button><button className="rounded border px-3 py-1" onClick={() => { editor?.commands.setContent(html); setEditing(false); useFileViewer.getState().setDirty(`${file.src}:${file.id}`, false); }}>Cancel</button><button className="rounded border px-2 py-1" onClick={() => editor?.chain().focus().undo().run()}>Undo</button><button className="rounded border px-2 py-1" onClick={() => editor?.chain().focus().redo().run()}>Redo</button><span>{status}</span></div><div className="min-h-0 flex-1 overflow-auto"><EditorContent editor={editor} /></div>{review && <div role="dialog" aria-label="Review document changes" className="absolute inset-x-6 top-14 z-20 rounded-xl border bg-white p-4 shadow-2xl"><div className="mb-2 font-medium">Review text changes before approval</div><div className="grid gap-3 text-xs md:grid-cols-2"><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-3 text-red-900">{change.removed || "No removed text"}</pre><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-green-50 p-3 text-green-900">{change.added || "No added text"}</pre></div><div className="mt-3 flex gap-2"><button className="rounded bg-indigo-600 px-3 py-1 text-white" onClick={() => void save()}>Save with approval</button><button className="rounded border px-3 py-1" onClick={() => setReview(false)}>Keep editing</button></div></div>}</div>;
  const safe = DOMPurify.sanitize(html, { FORBID_TAGS: ["script", "iframe", "object", "embed", "form"] });
  return <div className="relative h-full"><button className="absolute right-3 top-3 z-10 rounded bg-indigo-600 px-3 py-1 text-xs" onClick={startEdit}>Edit in Jazper</button><iframe title={file.name} sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'"><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 24px;line-height:1.55;color:#111}img{max-width:100%;height:auto}</style>${safe}`} className="h-full w-full border-0 bg-white" /></div>;
}
