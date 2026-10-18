"use client";
import { useEffect, useState, useCallback } from "react";
import { DollarSign, BarChart2, Clock, Zap, RefreshCw } from "lucide-react";

interface ModelSummary {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
}

interface DailyEntry {
  day: string;
  cost_usd: number;
  calls: number;
  total_tokens: number;
}

interface SourceEntry {
  source: string;
  cost_usd: number;
  calls: number;
}

interface RecentCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  source: string;
  session_id: string;
  created_at: string;
}

type Tab = "overview" | "daily" | "recent";

export default function ModelCostsPanel() {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(14);
  const [summary, setSummary] = useState<ModelSummary[]>([]);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifyInput, setClassifyInput] = useState("");
  const [classifyResult, setClassifyResult] = useState<{ tier: string; model: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, dayRes, srcRes, recRes] = await Promise.all([
        fetch(`/api/model-costs/summary?days=${days}`),
        fetch(`/api/model-costs/daily?days=${days}`),
        fetch(`/api/model-costs/by-source?days=${days}`),
        fetch("/api/model-costs/recent?limit=30"),
      ]);
      setSummary(await sumRes.json());
      setDaily(await dayRes.json());
      setSources(await srcRes.json());
      setRecent(await recRes.json());
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  async function classify() {
    if (!classifyInput.trim()) return;
    const res = await fetch("/api/model-costs/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: classifyInput }),
    });
    setClassifyResult(await res.json());
  }

  const totalCost = summary.reduce((s, r) => s + r.cost_usd, 0);
  const totalCalls = summary.reduce((s, r) => s + r.calls, 0);

  const TIER_COLOR: Record<string, string> = {
    simple: "#4ade80", medium: "#f59e0b", complex: "#f87171", chain: "#a78bfa",
  };

  const fmtCost = (n: number) => n < 0.001 ? `$${(n * 1000).toFixed(4)}m` : `$${n.toFixed(4)}`;
  const fmtDate = (s: string) => new Date(s).toLocaleString();

  return (
    <div style={{ padding: 24, height: "100%", overflowY: "auto", background: "#0f0f13", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DollarSign size={22} color="#4ade80" />
          <span style={{ fontSize: 20, fontWeight: 700, color: "#4ade80" }}>Model Costs</span>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>Groq spend tracker</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            style={{ background: "#1e1b2e", border: "1px solid #2d2d3a", borderRadius: 6,
              padding: "6px 10px", color: "#e2e8f0", fontSize: 12 }}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button onClick={load} style={{ background: "#1e1b2e", border: "1px solid #2d2d3a",
            borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "#64748b" }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: `Total spend (${days}d)`, value: fmtCost(totalCost), icon: <DollarSign size={16} color="#4ade80" />, color: "#4ade80" },
          { label: "Total LLM calls", value: totalCalls.toLocaleString(), icon: <BarChart2 size={16} color="#a78bfa" />, color: "#a78bfa" },
          { label: "Models used", value: summary.length, icon: <Zap size={16} color="#f59e0b" />, color: "#f59e0b" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "#1a1a24", border: "1px solid #2d2d3a", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, color: "#64748b", fontSize: 12 }}>
              {kpi.icon} {kpi.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Classifier */}
      <div style={{ background: "#1a1a24", border: "1px solid #2d2d3a", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#94a3b8" }}>
          Complexity classifier — test which model tier a message would use
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={classifyInput}
            onChange={e => setClassifyInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && classify()}
            placeholder="Type a message to classify…"
            style={{ flex: 1, background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
              padding: "8px 12px", color: "#e2e8f0", fontSize: 13 }}
          />
          <button onClick={classify} style={{ background: "#1e3a5f", color: "#60a5fa",
            border: "1px solid #1e40af", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>
            Classify
          </button>
        </div>
        {classifyResult && (
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ background: "#1a1a24", border: `1px solid ${TIER_COLOR[classifyResult.tier] ?? "#64748b"}`,
              color: TIER_COLOR[classifyResult.tier] ?? "#64748b", borderRadius: 6, padding: "4px 10px", fontSize: 13, fontWeight: 600 }}>
              {classifyResult.tier}
            </span>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>{classifyResult.model}</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>— {classifyResult.reason}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #2d2d3a" }}>
        {(["overview", "daily", "recent"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "8px 16px",
              color: tab === t ? "#4ade80" : "#64748b", fontSize: 13, fontWeight: tab === t ? 600 : 400,
              borderBottom: tab === t ? "2px solid #4ade80" : "2px solid transparent" }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", paddingTop: 40 }}>Loading…</div>
      ) : (
        <>
          {/* Overview tab */}
          {tab === "overview" && (
            <div>
              {summary.length === 0 ? (
                <div style={{ textAlign: "center", color: "#64748b", paddingTop: 30 }}>
                  No cost data yet — costs are logged after each LLM call.
                </div>
              ) : (
                <>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "#64748b", textAlign: "left" }}>
                        {["Model", "Calls", "Input tokens", "Output tokens", "Total cost"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid #2d2d3a" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map(r => (
                        <tr key={r.model} style={{ borderBottom: "1px solid #1a1a24" }}>
                          <td style={{ padding: "8px 10px", color: "#e2e8f0" }}>{r.model}</td>
                          <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{r.calls.toLocaleString()}</td>
                          <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{r.input_tokens.toLocaleString()}</td>
                          <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{r.output_tokens.toLocaleString()}</td>
                          <td style={{ padding: "8px 10px", color: "#4ade80", fontWeight: 600 }}>{fmtCost(r.cost_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 10 }}>By source</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {sources.map(s => (
                        <div key={s.source} style={{ background: "#1a1a24", border: "1px solid #2d2d3a",
                          borderRadius: 8, padding: "10px 16px" }}>
                          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{s.source}</div>
                          <div style={{ fontWeight: 600, color: "#4ade80" }}>{fmtCost(s.cost_usd)}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{s.calls} calls</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Daily tab */}
          {tab === "daily" && (
            <div>
              {daily.length === 0 ? (
                <div style={{ textAlign: "center", color: "#64748b", paddingTop: 30 }}>No daily data.</div>
              ) : (
                <>
                  {/* Simple bar chart */}
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, marginBottom: 16, padding: "0 4px" }}>
                    {(() => {
                      const max = Math.max(...daily.map(d => d.cost_usd), 0.000001);
                      return daily.map(d => (
                        <div key={d.day} title={`${d.day}: ${fmtCost(d.cost_usd)} (${d.calls} calls)`}
                          style={{ flex: 1, background: "#4ade80", borderRadius: "3px 3px 0 0",
                            height: `${Math.max((d.cost_usd / max) * 100, 4)}%`, minWidth: 0 }} />
                      ));
                    })()}
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "#64748b" }}>
                        {["Day", "Cost", "Calls", "Total tokens"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid #2d2d3a", textAlign: "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...daily].reverse().map(d => (
                        <tr key={d.day} style={{ borderBottom: "1px solid #1a1a24" }}>
                          <td style={{ padding: "7px 10px", color: "#e2e8f0" }}>{d.day}</td>
                          <td style={{ padding: "7px 10px", color: "#4ade80", fontWeight: 600 }}>{fmtCost(d.cost_usd)}</td>
                          <td style={{ padding: "7px 10px", color: "#94a3b8" }}>{d.calls}</td>
                          <td style={{ padding: "7px 10px", color: "#94a3b8" }}>{d.total_tokens.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* Recent tab */}
          {tab === "recent" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recent.length === 0 ? (
                <div style={{ textAlign: "center", color: "#64748b", paddingTop: 30 }}>No recent calls.</div>
              ) : recent.map((r, i) => (
                <div key={i} style={{ background: "#1a1a24", border: "1px solid #2d2d3a", borderRadius: 7,
                  padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 13, color: "#e2e8f0", marginRight: 10 }}>{r.model}</span>
                    <span style={{ background: "#1e1b2e", color: "#a78bfa", borderRadius: 3,
                      padding: "1px 6px", fontSize: 11 }}>{r.source}</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      {r.input_tokens}↑ {r.output_tokens}↓ tokens
                    </span>
                    <span style={{ fontWeight: 600, color: "#4ade80", fontSize: 13 }}>{fmtCost(r.cost_usd)}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      <Clock size={10} style={{ display: "inline", marginRight: 3 }} />
                      {fmtDate(r.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
