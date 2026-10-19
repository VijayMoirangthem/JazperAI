"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Activity, Filter } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface EvoEntry {
  id:             string;
  agent_codename: string;
  action_type:    string;
  target:         string;
  description:    string;
  payload:        Record<string, unknown>;
  outcome:        string;
  created_at:     string | null;
}

interface Stats {
  total:    number;
  by_type:  { action_type: string; count: number }[];
  by_agent: { agent: string; count: number }[];
}

// ── Action type colour map ─────────────────────────────────────────────────────
const ACTION_COLOR: Record<string, string> = {
  write_file:            "#f59e0b",
  run_command:           "#10b981",
  install_package:       "#f59e0b",
  create_agent:          "#a855f7",
  delete_agent:          "#ef4444",
  update_agent_settings: "#6366f1",
  update_agent_status:   "#6366f1",
  update_dept_settings:  "#3b82f6",
  save_memory:           "#06b6d4",
  web_search:            "#3b82f6",
};

const ACTION_ICON: Record<string, string> = {
  write_file:            "✎",
  run_command:           "$",
  install_package:       "📦",
  create_agent:          "🤖",
  delete_agent:          "🗑",
  update_agent_settings: "⚙",
  update_agent_status:   "🔄",
  update_dept_settings:  "🏢",
  save_memory:           "💾",
  web_search:            "🔍",
};

function actionColor(type: string) { return ACTION_COLOR[type] ?? "#64748b"; }
function actionIcon(type: string)  { return ACTION_ICON[type]  ?? "⚙"; }

function timeAgo(ts: string | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function EvolutionPanel() {
  const [entries,     setEntries]     = useState<EvoEntry[]>([]);
  const [stats,       setStats]       = useState<Stats | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterType,  setFilterType]  = useState("");
  const [expanded,    setExpanded]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filterAgent) params.set("agent", filterAgent);
      if (filterType)  params.set("action_type", filterType);

      const [er, sr] = await Promise.all([
        fetch(`${API}/api/evolution?${params}`),
        fetch(`${API}/api/evolution/stats`),
      ]);
      const [ed, sd] = await Promise.all([er.json(), sr.json()]);
      setEntries(ed.entries ?? []);
      setStats(sd);
    } catch { /* backend offline */ }
    setLoading(false);
  }, [filterAgent, filterType]);

  useEffect(() => { load(); }, [load]);

  // Unique agents for filter dropdown
  const uniqueAgents = Array.from(new Set(entries.map(e => e.agent_codename))).sort();
  const uniqueTypes  = Array.from(new Set(entries.map(e => e.action_type))).sort();

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Activity size={16} color="#6366f1" />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>
            Evolution Log
          </h2>
          <span style={{
            marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 10px",
            borderRadius: 20, background: "rgba(99,102,241,0.15)", color: "#6366f1",
          }}>
            {stats?.total ?? "—"} total mutations
          </span>
          <button
            onClick={load}
            title="Refresh"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", display: "flex" }}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Stats row */}
        {stats && stats.by_type.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {stats.by_type.slice(0, 6).map(t => (
              <button
                key={t.action_type}
                onClick={() => setFilterType(filterType === t.action_type ? "" : t.action_type)}
                style={{
                  background: filterType === t.action_type
                    ? `color-mix(in srgb, ${actionColor(t.action_type)} 22%, transparent)`
                    : "var(--color-card-inner)",
                  border: `1px solid color-mix(in srgb, ${actionColor(t.action_type)} 30%, transparent)`,
                  borderRadius: 20, padding: "3px 10px", cursor: "pointer",
                  fontSize: 10, fontFamily: "inherit",
                  color: actionColor(t.action_type),
                  fontWeight: filterType === t.action_type ? 800 : 500,
                }}
              >
                {actionIcon(t.action_type)} {t.action_type.replace(/_/g, " ")} · {t.count}
              </button>
            ))}
          </div>
        )}

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Filter size={10} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-dim)" }} />
            <select
              value={filterAgent}
              onChange={e => setFilterAgent(e.target.value)}
              style={{
                width: "100%", paddingLeft: 24, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
                background: "var(--color-card-inner)", border: "1px solid var(--color-border)",
                borderRadius: 7, color: "var(--color-text)", fontSize: 11, fontFamily: "inherit", outline: "none",
              }}
            >
              <option value="">All agents</option>
              {uniqueAgents.map(a => <option key={a} value={a}>@{a}</option>)}
            </select>
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{
              flex: 1, padding: "6px 8px",
              background: "var(--color-card-inner)", border: "1px solid var(--color-border)",
              borderRadius: 7, color: "var(--color-text)", fontSize: 11, fontFamily: "inherit", outline: "none",
            }}
          >
            <option value="">All actions</option>
            {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-dim)", fontSize: 12 }}>
            Loading evolution log…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--color-text-dim)" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No mutations yet</div>
            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
              Ask any agent to modify files, create agents, or run commands
            </div>
          </div>
        )}
        {!loading && entries.map((entry, idx) => {
          const clr = actionColor(entry.action_type);
          const isExpanded = expanded === entry.id;
          const isOk = entry.outcome !== "error";
          const outcomeColor = isOk ? clr : "#ef4444";

          return (
            <div
              key={entry.id}
              onClick={() => setExpanded(isExpanded ? null : entry.id)}
              style={{
                display: "flex", gap: 0, marginBottom: 4, cursor: "pointer",
                position: "relative",
              }}
            >
              {/* Timeline line */}
              {idx < entries.length - 1 && (
                <div style={{
                  position: "absolute", left: 15, top: 28, bottom: -4, width: 1,
                  background: "var(--color-border)",
                }} />
              )}

              {/* Dot */}
              <div style={{
                width: 30, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8,
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: outcomeColor,
                  boxShadow: `0 0 6px ${outcomeColor}`,
                  flexShrink: 0,
                }} />
              </div>

              {/* Card */}
              <div style={{
                flex: 1, background: "var(--color-card-inner)", borderRadius: 8, padding: "8px 12px",
                borderLeft: `2px solid ${clr}`,
                marginBottom: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12 }}>{actionIcon(entry.action_type)}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: clr, textTransform: "capitalize" }}>
                    {entry.action_type.replace(/_/g, " ")}
                  </span>
                  {entry.target && (
                    <span style={{
                      fontFamily: "monospace", fontSize: 10, padding: "1px 6px",
                      background: `color-mix(in srgb, ${clr} 10%, transparent)`,
                      borderRadius: 4, color: clr,
                    }}>
                      {entry.target.length > 50 ? entry.target.slice(0, 50) + "…" : entry.target}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--color-text-dim)", flexShrink: 0 }}>
                    @{entry.agent_codename} · {timeAgo(entry.created_at)}
                  </span>
                </div>
                {entry.description && (
                  <div style={{ fontSize: 10, color: "var(--color-text-dim)", marginTop: 3, lineHeight: 1.5 }}>
                    {entry.description}
                  </div>
                )}
                {!isOk && (
                  <div style={{ fontSize: 10, color: "#ef4444", marginTop: 3, fontWeight: 700 }}>✗ error</div>
                )}

                {/* Expanded payload */}
                {isExpanded && Object.keys(entry.payload).length > 0 && (
                  <div style={{
                    marginTop: 8, fontFamily: "monospace", fontSize: 9,
                    background: "rgba(0,0,0,0.3)", borderRadius: 5,
                    padding: "6px 8px", color: "var(--color-text-dim)",
                    whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto",
                  }}>
                    {JSON.stringify(entry.payload, null, 2)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
