"use client";

import { useCallback, useState } from "react";
import { useApi } from "@/lib/swr";
import { GitBranch } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const base = `${API}/api/v1/devloop`;

interface Run {
  id: string; task: string; files: string[]; test: string; status: string; attempt: number; branch?: string; diff?: string;
  history?: { attempt: number; exit: number }[]; merge?: string; merge_sha?: string; error?: string; isolated?: boolean;
}
interface RunsResponse { runs: Run[] }
const COLOR: Record<string, string> = { running: "#0284c7", verified: "#16a34a", rolled_back_escalated: "#dc2626", error: "#dc2626" };

/** Ask the model to change files on a throw-away agent-patch branch; tests verify (max 3 attempts); you review the diff and approve the merge. */
export function DevLoopPanel() {
  const [task, setTask] = useState("");
  const [files, setFiles] = useState("");
  const [test, setTest] = useState("pytest-backend");
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const { data, refresh, loading } = useApi<RunsResponse>(`${base}/runs`, { ttl: 3000, poll: 3000 });
  const runs = data?.runs ?? [];

  const start = async () => {
    const r = await fetch(`${base}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, files: files.split(/[\n,]+/).map((f) => f.trim()).filter(Boolean), test }) });
    if (!r.ok) { setMsg((await r.json().catch(() => ({}))).detail?.toString() ?? "failed"); return; }
    setMsg(""); setTask(""); const run = await r.json(); setSel(run.id); await refresh();
  };

  const act = async (id: string, verb: "merge" | "discard") => {
    await fetch(`${base}/runs/${id}${verb === "merge" ? "/merge" : ""}`, { method: verb === "merge" ? "POST" : "DELETE" });
    if (verb === "discard") setSel(null);
    await refresh();
  };

  const cur = runs.find((r) => r.id === sel);

  return (
    <div className="flex h-full min-h-[600px]">
      <div className="w-96 space-y-3 overflow-y-auto border-r p-4">
        <div className="flex items-center gap-2"><GitBranch size={18} /><h2 className="font-semibold">Dev Loop</h2><span className="text-xs text-red-400">{msg}</span></div>
        <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3} placeholder="What should change? e.g. “Make add() return the sum”" className="w-full rounded border bg-transparent p-2 text-sm" />
        <textarea value={files} onChange={(e) => setFiles(e.target.value)} rows={2} placeholder="files to edit (one per line, from project root)" className="w-full rounded border bg-transparent p-2 font-mono text-xs" />
        <div className="flex gap-2">
          <select value={test} onChange={(e) => setTest(e.target.value)} className="flex-1 rounded border bg-transparent px-2 py-1 text-xs">
            <option value="pytest-backend">Verify with backend pytest (on this machine)</option><option value="pytest-sandbox">Verify in Docker sandbox (isolated)</option><option value="none">No verification</option>
          </select>
          <button disabled={task.length < 5 || !files.trim()} onClick={start} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Run</button>
        </div>
        <div className="text-[11px] opacity-60">Runs on a separate branch in a worktree; the Docker option isolates the tests (no network, read-only copy). Nothing reaches your current branch without your approval.</div>
        {loading && runs.length === 0 && <div className="text-xs opacity-50">Loading…</div>}
        {runs.map((r) => (
          <button key={r.id} onClick={() => setSel(r.id)} className="block w-full rounded border p-2 text-left text-sm" style={{ background: sel === r.id ? "rgba(255,255,255,0.08)" : "transparent" }}>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: COLOR[r.status] ?? "#64748b" }} /><span className="truncate">{r.task}</span></div>
            <div className="text-[10px] opacity-60">{r.status} · attempt {r.attempt}/3{r.merge ? ` · merge ${r.merge}` : ""}</div>
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!cur && <p className="text-sm opacity-60">Start a run or pick one to see its result.</p>}
        {cur && (<>
          <div className="flex items-center gap-3"><span className="font-semibold">{cur.task}</span><span className="text-xs opacity-60">{cur.branch}</span>
            <div className="ml-auto flex gap-2">
              {cur.status === "verified" && !cur.merge && <button onClick={() => act(cur.id, "merge")} className="rounded bg-green-700 px-3 py-1 text-sm">Request merge</button>}
              <button onClick={() => act(cur.id, "discard")} className="rounded border px-3 py-1 text-sm">Discard</button>
            </div></div>
          {cur.merge === "awaiting-approval" && <div className="rounded bg-amber-500/20 p-2 text-sm">Approve or deny in Chat (approval card) — the merge happens only after you approve.</div>}
          {cur.merge === "merged" && <div className="rounded bg-green-500/20 p-2 text-sm">Merged ({cur.merge_sha?.slice(0, 8)}).</div>}
          {cur.status === "rolled_back_escalated" && <div className="rounded bg-red-500/20 p-2 text-sm">Gave up after 3 failed attempts; the branch was rolled back and an escalation was raised.</div>}
          {cur.error && <div className="rounded bg-red-500/20 p-2 text-sm">{cur.error}</div>}
          <div className="text-xs opacity-70">{(cur.history ?? []).map((h) => `attempt ${h.attempt}: ${h.exit === 0 ? "tests passed" : `failed (exit ${h.exit})`}`).join(" · ")}</div>
          {cur.diff && <pre className="max-h-[60vh] overflow-auto rounded bg-black/40 p-3 text-xs">{cur.diff.split("\n").map((l, i) => <div key={i} style={{ color: l.startsWith("+") && !l.startsWith("+++") ? "#4ade80" : l.startsWith("-") && !l.startsWith("---") ? "#f87171" : undefined }}>{l}</div>)}</pre>}
        </>)}
      </div>
    </div>
  );
}