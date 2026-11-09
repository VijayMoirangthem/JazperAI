"use client";

import { useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { useApi } from "@/lib/swr";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Card { calls: number; errors: number; avg_latency_ms: number; thumbs_up: number; thumbs_down: number; score: number | null; grade: string; last_active_at: string | null; tier: string }
interface Routing { [tier: string]: { provider: string; model: string }[] }
interface Finops { today: { calls: number; input_tokens: number; output_tokens: number; cost_usd: number | null }; by_agent: { k: string; calls: number; tokens: number }[] }
interface Perf { cpu_pct_one_core: number; rss_mb: number; agents: { active: number; total: number }; tasks: { agent: { running: number; waiting: number } }; warnings: string[] }

// Targets Jazper is measured against. They are goals to work towards, not claims about current quality.
const TARGET_LATENCY_MS = 3000;
const TARGET_SUCCESS = 0.98;

const tone = (ok: boolean | null) => (ok === null ? "#94a3b8" : ok ? "#22c55e" : "#f59e0b");

function Metric({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok: boolean | null }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", opacity: 0.6, letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: tone(ok) }}>{value}</div>
      {sub && <div style={{ fontSize: 9, opacity: 0.55 }}>{sub}</div>}
    </div>
  );
}

/** How Jazper is performing overall, from real recorded data (calls, errors, latency, ratings) plus the model and resources in use. */
export function JazperPerformanceStrip() {
  const [open, setOpen] = useState(false);
  const card = useApi<Card>(`${API}/api/v1/bots/jasper/card`, { ttl: 15000, poll: 30000 });
  const routing = useApi<Routing>(`${API}/api/v1/llm/routing`, { ttl: 60000, poll: false });
  const fin = useApi<Finops>(`${API}/api/v1/finops/summary`, { ttl: 15000, poll: 30000 });
  const perf = useApi<Perf>(`${API}/api/performance/status`, { ttl: 5000, poll: open ? 5000 : 30000 });

  const c = card.data;
  if (!c) return null;
  const success = c.calls > 0 ? (c.calls - c.errors) / c.calls : null;
  const rated = c.thumbs_up + c.thumbs_down;
  const approval = rated > 0 ? c.thumbs_up / rated : null;
  const latOk = c.calls > 0 ? c.avg_latency_ms <= TARGET_LATENCY_MS : null;
  const sucOk = success === null ? null : success >= TARGET_SUCCESS;
  const head = routing.data?.[c.tier === "frontier" ? "frontier" : c.tier]?.[0] ?? routing.data?.frontier?.[0];
  const model = head ? `${head.model}` : "—";
  const jasperToday = fin.data?.by_agent.find((a) => a.k === "jasper" || a.k === "jasper-chat");
  const free = fin.data ? (fin.data.today.cost_usd ?? 0) === 0 : null;

  // What to work on first, in plain words.
  const gaps: string[] = [];
  if (latOk === false) gaps.push(`Responses average ${(c.avg_latency_ms / 1000).toFixed(1)} s (target ≤ ${TARGET_LATENCY_MS / 1000} s).`);
  if (sucOk === false && success !== null) gaps.push(`${(100 - success * 100).toFixed(1)}% of calls fail (target ≤ ${((1 - TARGET_SUCCESS) * 100).toFixed(0)}%).`);
  if (rated === 0) gaps.push("No 👍/👎 ratings yet, so answer quality is unmeasured. Rate replies to give Jazper a quality score.");
  if (c.calls === 0) gaps.push("No recorded calls yet.");

  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid var(--color-border, rgba(255,255,255,0.08))", background: "rgba(99,102,241,0.05)", fontSize: 11 }}>
      <button onClick={() => setOpen(!open)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "5px 12px", background: "transparent", border: "none", color: "inherit", cursor: "pointer", textAlign: "left" }}
        aria-expanded={open} aria-label="Jazper performance">
        <Activity size={12} style={{ opacity: 0.7 }} />
        <span style={{ fontWeight: 600 }}>Jazper performance</span>
        <span style={{ opacity: 0.75 }}>
          {c.calls === 0 ? "no data yet" : `${c.grade}${c.score !== null ? ` · ${c.score}/100` : ""} · avg ${(c.avg_latency_ms / 1000).toFixed(1)} s · ${(success! * 100).toFixed(0)}% success · ${c.calls} calls`}
        </span>
        <span style={{ opacity: 0.6, marginLeft: "auto" }}>{model}{free ? " · free" : ""}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div style={{ padding: "6px 12px 10px", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <Metric label="Overall score" value={c.score === null ? "—" : `${c.score}/100`} sub={c.grade} ok={c.score === null ? null : c.score >= 80} />
            <Metric label="Avg response" value={c.calls ? `${(c.avg_latency_ms / 1000).toFixed(1)} s` : "—"} sub={`target ≤ ${TARGET_LATENCY_MS / 1000} s`} ok={latOk} />
            <Metric label="Success rate" value={success === null ? "—" : `${(success * 100).toFixed(1)}%`} sub={`${c.errors} errors / ${c.calls} calls`} ok={sucOk} />
            <Metric label="User ratings" value={approval === null ? "none yet" : `${(approval * 100).toFixed(0)}% 👍`} sub={`${c.thumbs_up} up · ${c.thumbs_down} down`} ok={approval === null ? null : approval >= 0.8} />
            <Metric label="Model (Jazper)" value={model} sub={`tier ${c.tier}`} ok={null} />
            <Metric label="Tokens today" value={fin.data ? (fin.data.today.input_tokens + fin.data.today.output_tokens).toLocaleString() : "—"} sub={`${fin.data?.today.calls ?? 0} calls${free ? " · free models" : ""}`} ok={null} />
            {jasperToday && <Metric label="Jazper today" value={`${jasperToday.calls} calls`} sub={`${Number(jasperToday.tokens).toLocaleString()} tokens`} ok={null} />}
            {perf.data && <Metric label="App load" value={`${perf.data.cpu_pct_one_core.toFixed(0)}% CPU`} sub={`${Math.round(perf.data.rss_mb)} MB · ${perf.data.agents.active}/${perf.data.agents.total} agents`} ok={perf.data.warnings.length === 0} />}
          </div>
          {gaps.length > 0 && (
            <div style={{ border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", borderRadius: 6, padding: "6px 8px" }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Work on next</div>
              {gaps.map((g) => <div key={g}>• {g}</div>)}
            </div>
          )}
          {perf.data?.warnings.map((w) => <div key={w} style={{ color: "#f59e0b" }}>⚠ {w}</div>)}
          <div style={{ opacity: 0.5, fontSize: 9 }}>Numbers come from Jazper's recorded calls (shared.bot_stats), FinOps and the live resource monitor. Targets are goals, not results.</div>
        </div>
      )}
    </div>
  );
}
