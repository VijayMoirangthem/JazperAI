"use client";

import { useMemo, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Check, FileDiff, X } from "lucide-react";
import { readNdjson } from "@/chat/ndjson";
import { applyAccepted, type Hunk } from "@/lib/applyHunks";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DiffEvent { op: "begin" | "hunk" | "end" | "abort"; hunks: Hunk[]; branch: string }

/** Streamed AI edit: hunks arrive while the model writes; each can be accepted or rejected, then applied to disk. */
export function DiffEditorPanel() {
  const [path, setPath] = useState("");
  const [instruction, setInstruction] = useState("");
  const [original, setOriginal] = useState("");
  const [hunks, setHunks] = useState<Hunk[]>([]);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"idle" | "streaming" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const abort = useRef<AbortController | null>(null);
  const modified = useMemo(() => applyAccepted(original, hunks, rejected), [original, hunks, rejected]);

  const run = async () => {
    setMsg(""); setHunks([]); setRejected(new Set()); setState("streaming");
    abort.current = new AbortController();
    try {
      const f = await fetch(`${API}/api/v1/edit/file?path=${encodeURIComponent(path)}`);
      if (!f.ok) throw new Error((await f.json().catch(() => ({}))).detail ?? "cannot read file");
      setOriginal((await f.json()).content);
      const res = await fetch(`${API}/api/v1/edit/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ path, instruction }) });
      for await (const ev of readNdjson<DiffEvent>(res)) {
        if (ev.op === "hunk") setHunks((h) => [...h, ...ev.hunks]);
        if (ev.op === "abort") throw new Error("the model request failed");
      }
      setState("done");
    } catch (e) {
      setState((e as Error).name === "AbortError" ? "idle" : "error");
      setMsg((e as Error).name === "AbortError" ? "Stopped" : String(e));
    }
  };

  const apply = async () => {
    const r = await fetch(`${API}/api/v1/edit/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: modified }) });
    setMsg(r.ok ? `Applied to ${path} (previous version saved as ${path}.jasper-bak)` : "Apply failed");
    if (r.ok) { setOriginal(modified); setHunks([]); }
  };
  const toggle = (id: string) => setRejected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const accepted = hunks.length - rejected.size;

  return (
    <div className="flex h-full min-h-[600px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <FileDiff size={18} />
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="path from project root, e.g. backend/python/core/hitl.py" className="w-96 rounded border bg-transparent px-2 py-1 text-sm" />
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && path && instruction && run()} placeholder="what should change?" className="min-w-64 flex-1 rounded border bg-transparent px-2 py-1 text-sm" />
        {state === "streaming" ? <button onClick={() => abort.current?.abort()} className="rounded border px-3 py-1 text-sm">Stop</button>
          : <button disabled={!path || !instruction} onClick={run} className="rounded border px-3 py-1 text-sm">Edit</button>}
        <button disabled={!hunks.length || accepted === 0 || state === "streaming"} onClick={apply} className="rounded bg-green-700 px-3 py-1 text-sm disabled:opacity-40">Apply {accepted || ""} hunk{accepted === 1 ? "" : "s"}</button>
        <span className="text-xs opacity-70">{state === "streaming" ? "streaming…" : msg}</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <DiffEditor height="100%" theme="vs-dark" original={original} modified={modified} language={path.split(".").pop() === "py" ? "python" : path.split(".").pop() === "ts" || path.split(".").pop() === "tsx" ? "typescript" : undefined}
            options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, automaticLayout: true }} />
        </div>
        <aside className="w-72 space-y-2 overflow-y-auto border-l p-2">
          <div className="text-xs uppercase opacity-60">Hunks ({hunks.length})</div>
          {hunks.map((h, i) => (
            <div key={h.id} className="rounded border p-2" style={{ opacity: rejected.has(h.id) ? 0.45 : 1 }}>
              <div className="mb-1 flex items-center text-xs"><span>#{i + 1} · line {h.old_start + 1}</span>
                <button onClick={() => toggle(h.id)} className="ml-auto rounded border px-2 py-0.5" title={rejected.has(h.id) ? "Accept" : "Reject"}>{rejected.has(h.id) ? <Check size={12} /> : <X size={12} />}</button></div>
              <pre className="max-h-28 overflow-auto text-[11px] leading-snug font-mono">{h.patch}</pre>
            </div>
          ))}
          {hunks.length === 0 && state !== "streaming" && <p className="text-xs opacity-60">Describe a change; hunks stream in as the model writes.</p>}
        </aside>
      </div>
    </div>
  );
}
