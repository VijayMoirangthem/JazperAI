"use client";

// Every registered model with price, 7-day usage, last test result and compare record. Test one model, or tick 2-3 and compare them side by side.
import { useMemo, useState } from "react";
import { useApi } from "@/lib/swr";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export interface CatalogModel {
  key: string; provider: string; provider_name: string; kind: string; model: string; enabled: boolean;
  input_per_m: number | null; output_per_m: number | null; calls_7d: number; avg_latency_ms: number | null; cost_7d: number;
  last_test?: { ok: boolean; latency_ms?: number; status?: string; error?: string; at?: number } | null; wins: number; losses: number;
}
interface CompareResult { key: string; ok: boolean; text?: string; error?: string; ms: number; input_tokens?: number; output_tokens?: number; cost_usd?: number | null }

const STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: "works", color: "#22c55e" }, no_credit: { label: "needs credit", color: "#f59e0b" }, blocked: { label: "blocked", color: "#ef4444" },
  bad_key: { label: "bad key", color: "#ef4444" }, rate_limited: { label: "rate limited", color: "#f59e0b" }, error: { label: "error", color: "#ef4444" },
};
const price = (m: CatalogModel) => (m.input_per_m === null ? "—" : m.input_per_m === 0 && (m.output_per_m ?? 0) === 0 ? "free" : `$${m.input_per_m} / $${m.output_per_m}`);

export function CompareModal({ keys, onClose }: { keys: string[]; onClose: () => void }) {
  const [prompt, setPrompt] = useState("Explain in three sentences why a startup should keep a written decision log.");
  const [res, setRes] = useState<CompareResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [voted, setVoted] = useState("");
  const run = async () => {
    setBusy(true); setRes(null); setVoted("");
    try { const d = await fetch(`${API}/api/v1/llm/compare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, models: keys }) }).then((r) => r.json()); setRes(d.results ?? []); }
    finally { setBusy(false); }
  };
  const vote = async (winner: string) => {
    await fetch(`${API}/api/v1/llm/compare/vote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ winner, others: keys.filter((k) => k !== winner) }) });
    setVoted(winner);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div data-testid="compare-modal" role="dialog" aria-label="Compare models" className="flex max-h-[88vh] w-[min(1100px,94vw)] flex-col rounded-2xl border border-white/10 bg-[#1b1b1b] p-4 shadow-2xl">
        <div className="mb-2 flex items-center"><h3 className="font-semibold">Compare models</h3><button onClick={onClose} className="ml-auto text-sm opacity-60 hover:opacity-100">Close</button></div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label="Prompt" className="w-full rounded-lg bg-white/10 p-2 text-sm outline-none" />
        <div className="my-2 flex items-center gap-2 text-xs opacity-70"><span>{keys.join("  ·  ")}</span><button onClick={() => void run()} disabled={busy || !prompt.trim()} data-testid="compare-run" className="ml-auto rounded-full bg-blue-600 px-4 py-1.5 text-sm text-white opacity-100 disabled:opacity-50">{busy ? "Running…" : "Run on all"}</button></div>
        <div className="grid flex-1 gap-3 overflow-y-auto" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
          {keys.map((k) => {
            const r = res?.find((x) => x.key === k);
            return (
              <div key={k} className="flex min-h-[160px] flex-col rounded-xl bg-white/5 p-3 text-sm" data-testid={"cmp-" + k}>
                <div className="mb-1 truncate text-xs font-semibold opacity-80">{k}</div>
                {!r ? <div className="opacity-40">{busy ? "…" : "—"}</div> : !r.ok ? <div className="text-red-400">{r.error}</div> : <div className="whitespace-pre-wrap">{r.text}</div>}
                {r && <div className="mt-auto pt-2 text-[11px] opacity-60">{r.ms} ms{r.ok ? ` · ${r.input_tokens}→${r.output_tokens} tok${r.cost_usd ? ` · $${r.cost_usd.toFixed(5)}` : ""}` : ""}</div>}
                {r?.ok && <button onClick={() => void vote(k)} disabled={!!voted} className="mt-1 rounded-full bg-white/10 px-3 py-1 text-xs disabled:opacity-50">{voted === k ? "Best ✓" : "This one is best"}</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ModelCatalog() {
  const { data, refresh } = useApi<{ models: CatalogModel[] }>(`${API}/api/v1/llm/catalog`, { ttl: 15_000, poll: false });
  const [q, setQ] = useState("");
  const [prov, setProv] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [sort, setSort] = useState<"model" | "price" | "calls" | "latency">("calls");
  const [pick, setPick] = useState<string[]>([]);
  const [testing, setTesting] = useState("");
  const [cmp, setCmp] = useState(false);
  const rows = useMemo(() => {
    const l = (data?.models ?? []).filter((m) => (!q || m.key.toLowerCase().includes(q.toLowerCase())) && (!prov || m.provider === prov) && (!freeOnly || (m.input_per_m === 0 && (m.output_per_m ?? 0) === 0)));
    const val = (m: CatalogModel) => sort === "price" ? (m.input_per_m ?? 1e9) : sort === "calls" ? -m.calls_7d : sort === "latency" ? (m.avg_latency_ms ?? 1e9) : 0;
    return [...l].sort((a, b) => sort === "model" ? a.key.localeCompare(b.key) : val(a) - val(b));
  }, [data, q, prov, freeOnly, sort]);
  const provs = [...new Set((data?.models ?? []).map((m) => m.provider))];
  const test = async (m: CatalogModel) => {
    setTesting(m.key);
    try { await fetch(`${API}/api/v1/llm/catalog/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: m.provider, model: m.model }) }); await refresh(); } finally { setTesting(""); }
  };
  const toggle = (k: string) => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length < 3 ? [...p, k] : p));
  return (
    <div className="mt-8" data-testid="model-catalog">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Model catalogue</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter models" className="rounded-lg bg-white/10 px-2 py-1 text-xs outline-none" />
        <select value={prov} onChange={(e) => setProv(e.target.value)} aria-label="Provider filter" className="rounded-lg bg-white/10 px-2 py-1 text-xs"><option value="">all providers</option>{provs.map((p) => <option key={p} value={p} className="bg-[#1b1b1b]">{p}</option>)}</select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />free only</label>
        <button onClick={() => setCmp(true)} disabled={pick.length < 2} data-testid="compare-open" className="ml-auto rounded-full bg-blue-600 px-3 py-1 text-xs disabled:opacity-40">Compare {pick.length >= 2 ? pick.length : ""} selected</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 opacity-70"><tr>
            <th className="p-2" /><th className="cursor-pointer p-2" onClick={() => setSort("model")}>Model</th><th className="cursor-pointer p-2" onClick={() => setSort("price")}>$ in / out per 1M</th>
            <th className="cursor-pointer p-2" onClick={() => setSort("calls")}>Calls 7d</th><th className="cursor-pointer p-2" onClick={() => setSort("latency")}>Avg ms</th><th className="p-2">Status</th><th className="p-2">Votes</th><th className="p-2" />
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const st = m.last_test ? (m.last_test.ok ? STATUS.ok : STATUS[m.last_test.status ?? "error"] ?? STATUS.error) : null;
              return (
                <tr key={m.key} className="border-t border-white/5" data-testid={"cat-" + m.key}>
                  <td className="p-2"><input type="checkbox" aria-label={`Select ${m.key}`} checked={pick.includes(m.key)} onChange={() => toggle(m.key)} /></td>
                  <td className="p-2"><div className="font-medium">{m.model}</div><div className="opacity-50">{m.provider_name}{m.kind === "cli" ? " · chat only, slow" : ""}</div></td>
                  <td className="p-2">{price(m)}</td><td className="p-2">{m.calls_7d}</td><td className="p-2">{m.avg_latency_ms ?? "—"}</td>
                  <td className="p-2">{st ? <span title={m.last_test?.error} className="rounded-full px-2 py-0.5" style={{ background: st.color + "22", color: st.color }}>{st.label}{m.last_test?.ok && m.last_test.latency_ms ? ` ${m.last_test.latency_ms}ms` : ""}</span> : <span className="opacity-40">untested</span>}</td>
                  <td className="p-2">{m.wins || m.losses ? `${m.wins}W / ${m.losses}L` : "—"}</td>
                  <td className="p-2"><button onClick={() => void test(m)} disabled={testing === m.key} className="rounded-full bg-white/10 px-2.5 py-0.5 disabled:opacity-50">{testing === m.key ? "…" : "Test"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-[11px] opacity-50">Prices come from the Model Costs table (OpenCode prices from opencode.ai/docs/zen, read 2026-10-21; Groq free tier is $0). Context windows are not reported by the providers, so they are not shown.</div>
      {cmp && <CompareModal keys={pick} onClose={() => setCmp(false)} />}
    </div>
  );
}
