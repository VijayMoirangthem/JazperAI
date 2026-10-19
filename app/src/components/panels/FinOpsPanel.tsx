"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const base = `${API}/api/v1/finops`;

interface Row { k: string; calls: number; tokens: number }
interface Summary {
  today: { calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number | null };
  by_division: Row[]; by_agent: Row[]; by_model: Row[];
  forecast: { tokens_per_hour: number; tokens_next_24h: number };
  budgets: { scope: string; daily_soft: number | null; daily_hard: number | null }[];
}
const fmt = (n: number) => n.toLocaleString();

function Bars({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.tokens)));
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase opacity-60">{title}</div>
      {rows.length === 0 && <div className="text-xs opacity-50">no usage yet today</div>}
      {rows.map((r) => (
        <div key={r.k} className="text-xs">
          <div className="flex justify-between"><span className="font-mono">{r.k}</span><span>{fmt(Number(r.tokens))} tok · {r.calls} calls</span></div>
          <div className="h-1.5 rounded bg-white/10"><div className="h-1.5 rounded bg-indigo-500" style={{ width: `${(Number(r.tokens) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Token usage by division/agent/model, burn-rate forecast, and daily budgets (soft = step the model tier down, hard = stop). */
export function FinOpsPanel() {
  const [s, setS] = useState<Summary | null>(null);
  const [b, setB] = useState({ scope: "global", soft: "", hard: "" });
  const [msg, setMsg] = useState("");
  const load = useCallback(() => fetch(`${base}/summary`).then((r) => r.json()).then(setS).catch(() => setMsg("Backend unreachable")), []);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const save = async () => {
    const num = (v: string) => (v.trim() ? Number(v) : null);
    const r = await fetch(`${base}/budgets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: b.scope, daily_soft: num(b.soft), daily_hard: num(b.hard) }) });
    setMsg(r.ok ? `Budget saved for ${b.scope}` : "Failed"); load();
  };

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3"><Gauge size={20} /><h2 className="text-lg font-semibold">FinOps</h2>{msg && <span className="text-xs opacity-70">{msg}</span>}</div>
      {s && (<>
        <section className="grid grid-cols-4 gap-3 text-sm">
          {[["Calls today", fmt(s.today.calls)], ["Input tokens", fmt(s.today.input_tokens)], ["Output tokens", fmt(s.today.output_tokens)],
            ["Cost", s.today.cost_usd == null ? "set prices in core/pricing.yaml" : `$${s.today.cost_usd.toFixed(4)}`]].map(([k, v]) => (
            <div key={k} className="rounded border p-3"><div className="text-xs opacity-60">{k}</div><div className="mt-1 font-semibold">{v}</div></div>))}
        </section>
        <div className="text-xs opacity-70">Burn rate (last 3 h): {fmt(s.forecast.tokens_per_hour)} tokens/h → about {fmt(s.forecast.tokens_next_24h)} in the next 24 h</div>
        <section className="grid grid-cols-3 gap-6"><Bars title="By division" rows={s.by_division} /><Bars title="By agent" rows={s.by_agent} /><Bars title="By model" rows={s.by_model} /></section>
        <section className="space-y-2 rounded border p-3">
          <div className="text-sm font-medium">Daily token budgets</div>
          {s.budgets.map((x) => <div key={x.scope} className="flex gap-4 font-mono text-xs"><span className="w-56">{x.scope}</span><span>soft {x.daily_soft ?? "–"}</span><span>hard {x.daily_hard ?? "–"}</span></div>)}
          <div className="flex gap-2 pt-1">
            <input value={b.scope} onChange={(e) => setB({ ...b, scope: e.target.value })} placeholder="global | division:baeit | agent:forge" className="w-72 rounded border bg-transparent px-2 py-1 font-mono text-xs" />
            <input value={b.soft} onChange={(e) => setB({ ...b, soft: e.target.value })} placeholder="soft" className="w-28 rounded border bg-transparent px-2 py-1 text-xs" />
            <input value={b.hard} onChange={(e) => setB({ ...b, hard: e.target.value })} placeholder="hard" className="w-28 rounded border bg-transparent px-2 py-1 text-xs" />
            <button onClick={save} className="rounded border px-3 py-1 text-xs">Save</button>
          </div>
        </section>
      </>)}
    </div>
  );
}
