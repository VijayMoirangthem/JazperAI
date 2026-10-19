"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Database, RotateCcw } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DBChange {
  id:             string;
  agent_name:     string;
  table_name:     string;
  operation:      string;
  row_id:         string;
  before_json:    Record<string, unknown> | null;
  after_json:     Record<string, unknown> | null;
  sql_hint:       string;
  created_at:     string | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
}

const OP_COLOR: Record<string, string> = {
  INSERT: "#10b981",
  UPDATE: "#f59e0b",
  DELETE: "#ef4444",
  SELECT: "#64748b",
};

function opColor(op: string) { return OP_COLOR[op.toUpperCase()] ?? "#64748b"; }

function timeAgo(ts: string | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function DBChangeLogPanel() {
  const [changes,    setChanges]    = useState<DBChange[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [rolling,    setRolling]    = useState<string | null>(null);
  const [hours,      setHours]      = useState(24);
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [filterTable, setFilterTable] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/db-changes?hours=${hours}&limit=200`);
      const d = await r.json();
      setChanges(d.changes ?? []);
    } catch { /* backend offline */ }
    setLoading(false);
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  async function rollback(id: string) {
    setRolling(id);
    try {
      const r = await fetch(`${API}/api/db-changes/${id}/rollback`, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setChanges(prev => prev.map(c =>
          c.id === id ? { ...c, rolled_back_at: new Date().toISOString(), rolled_back_by: "user" } : c
        ));
      }
    } catch { /**/ }
    setRolling(null);
  }

  const tables = Array.from(new Set(changes.map(c => c.table_name))).sort();
  const visible = filterTable ? changes.filter(c => c.table_name === filterTable) : changes;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Database size={16} color="#6366f1" />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--color-text)" }}>
            DB Change Log
          </h2>
          <span style={{
            marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 10px",
            borderRadius: 20, background: "rgba(99,102,241,0.15)", color: "#6366f1",
          }}>
            {visible.length} changes
          </span>
          <button onClick={load} title="Refresh"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", display: "flex" }}>
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            style={{ padding: "6px 8px", background: "var(--color-card-inner)", border: "1px solid var(--color-border)", borderRadius: 7, color: "var(--color-text)", fontSize: 11, fontFamily: "inherit", outline: "none" }}
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
          </select>
          <select
            value={filterTable}
            onChange={e => setFilterTable(e.target.value)}
            style={{ flex: 1, padding: "6px 8px", background: "var(--color-card-inner)", border: "1px solid var(--color-border)", borderRadius: 7, color: "var(--color-text)", fontSize: 11, fontFamily: "inherit", outline: "none" }}
          >
            <option value="">All tables</option>
            {tables.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Op summary pills */}
      {!loading && changes.length > 0 && (
        <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 8, flexShrink: 0 }}>
          {(["INSERT","UPDATE","DELETE"] as const).map(op => {
            const cnt = changes.filter(c => c.operation.toUpperCase() === op).length;
            if (!cnt) return null;
            return (
              <span key={op} style={{
                fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                background: `color-mix(in srgb, ${opColor(op)} 14%, transparent)`,
                color: opColor(op),
              }}>
                {op} · {cnt}
              </span>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-dim)", fontSize: 12 }}>
            Loading changes…
          </div>
        )}
        {!loading && visible.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--color-text-dim)" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🗄️</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No DB changes recorded</div>
            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
              Agent mutations to the database appear here
            </div>
          </div>
        )}
        {!loading && visible.map(c => {
          const clr      = opColor(c.operation);
          const isRolled = !!c.rolled_back_at;
          const isExp    = expanded === c.id;

          return (
            <div
              key={c.id}
              onClick={() => setExpanded(isExp ? null : c.id)}
              style={{
                padding: "10px 20px", borderBottom: "1px solid var(--color-border)",
                cursor: "pointer", opacity: isRolled ? 0.5 : 1,
                background: isExp ? "var(--color-card-inner)" : "transparent",
                transition: "background 0.1s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Op badge */}
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4,
                  background: `color-mix(in srgb, ${clr} 16%, transparent)`, color: clr,
                  flexShrink: 0, textTransform: "uppercase",
                }}>
                  {c.operation}
                </span>

                {/* Table */}
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text)", fontFamily: "monospace" }}>
                  {c.table_name}
                </span>

                {/* Row ID */}
                {c.row_id && (
                  <span style={{ fontSize: 10, color: "var(--color-text-dim)", fontFamily: "monospace" }}>
                    #{c.row_id.slice(0, 8)}
                  </span>
                )}

                {/* Agent */}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-dim)", flexShrink: 0 }}>
                  @{c.agent_name} · {timeAgo(c.created_at)}
                </span>

                {/* Rollback / rolled-back indicator */}
                {isRolled ? (
                  <span style={{ fontSize: 9, color: "#64748b", fontWeight: 700, flexShrink: 0 }}>rolled back</span>
                ) : (c.operation.toUpperCase() !== "SELECT") && (
                  <button
                    onClick={e => { e.stopPropagation(); rollback(c.id); }}
                    disabled={rolling === c.id}
                    title="Rollback this change"
                    style={{
                      background: "var(--color-card-inner)", border: "1px solid var(--color-border)",
                      borderRadius: 5, padding: "3px 6px", cursor: rolling === c.id ? "wait" : "pointer",
                      color: "#ef4444", display: "flex", alignItems: "center", gap: 3, fontSize: 10,
                      fontFamily: "inherit", flexShrink: 0,
                    }}
                  >
                    <RotateCcw size={9} />
                    {rolling === c.id ? "…" : "Undo"}
                  </button>
                )}
              </div>

              {/* sql_hint */}
              {c.sql_hint && (
                <div style={{ fontFamily: "monospace", fontSize: 9, color: "var(--color-text-dim)", marginTop: 4, paddingLeft: 4 }}>
                  {c.sql_hint.length > 100 ? c.sql_hint.slice(0, 100) + "…" : c.sql_hint}
                </div>
              )}

              {/* Expanded diff */}
              {isExp && (c.before_json || c.after_json) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  {c.before_json && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", marginBottom: 4, textTransform: "uppercase" }}>Before</div>
                      <pre style={{
                        margin: 0, fontFamily: "monospace", fontSize: 9, padding: "6px 8px",
                        background: "rgba(239,68,68,0.06)", borderRadius: 5, color: "var(--color-text-dim)",
                        whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto",
                      }}>
                        {JSON.stringify(c.before_json, null, 2)}
                      </pre>
                    </div>
                  )}
                  {c.after_json && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 800, color: "#10b981", marginBottom: 4, textTransform: "uppercase" }}>After</div>
                      <pre style={{
                        margin: 0, fontFamily: "monospace", fontSize: 9, padding: "6px 8px",
                        background: "rgba(16,185,129,0.06)", borderRadius: 5, color: "var(--color-text-dim)",
                        whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto",
                      }}>
                        {JSON.stringify(c.after_json, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
