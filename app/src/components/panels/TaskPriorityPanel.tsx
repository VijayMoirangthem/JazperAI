"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, RefreshCw, Loader2, AlertCircle, ArrowUp, Minus, ArrowDown } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type Urgency = "critical" | "high" | "medium" | "low";

interface RankedTask {
  id: string;
  title: string;
  rank: number;
  urgency: Urgency;
  reason: string;
  due_date?: string | null;
  status?: string;
}

interface PriorityResult {
  ranked: RankedTask[];
  analyzed_at: string;
  cached: boolean;
}

const URGENCY_META: Record<Urgency, { label: string; color: string; icon: React.ReactNode }> = {
  critical: { label: "Critical", color: "#ef4444", icon: <AlertCircle size={11} /> },
  high:     { label: "High",     color: "#f59e0b", icon: <ArrowUp size={11} /> },
  medium:   { label: "Medium",   color: "#3b82f6", icon: <Minus size={11} /> },
  low:      { label: "Low",      color: "#6b7280", icon: <ArrowDown size={11} /> },
};

function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const m = URGENCY_META[urgency] || URGENCY_META.medium;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, padding: "2px 7px", borderRadius: "var(--r-full)", background: `${m.color}18`, border: `1px solid ${m.color}44`, color: m.color, fontWeight: 700 }}>
      {m.icon} {m.label}
    </span>
  );
}

function fmtDate(ts: string | null | undefined) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
    if (diff < 0)  return { label: `${Math.abs(diff)}d overdue`, color: "#ef4444" };
    if (diff === 0) return { label: "Due today", color: "#f59e0b" };
    if (diff === 1) return { label: "Due tomorrow", color: "#f59e0b" };
    return { label: `Due in ${diff}d`, color: "var(--color-text-muted)" };
  } catch { return null; }
}

export function TaskPriorityPanel() {
  const toast = useToast();

  const [data, setData]           = useState<PriorityResult | null>(null);
  const [loading, setLoading]     = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [filter, setFilter]       = useState<Urgency | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/task-priority`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await fetch(`${API}/api/task-priority/analyze`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData({ ...result, cached: false });
      toast(`Prioritized ${result.ranked?.length || 0} tasks`, "success");
    } catch (e) {
      toast(`Analysis failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setAnalyzing(false); }
  }

  const ranked = data?.ranked || [];
  const filtered = filter === "all" ? ranked : ranked.filter(t => t.urgency === filter);
  const counts = (["critical", "high", "medium", "low"] as Urgency[]).reduce((acc, u) => {
    acc[u] = ranked.filter(t => t.urgency === u).length;
    return acc;
  }, {} as Record<Urgency, number>);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Sparkles size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Task Priority</span>
        {data?.analyzed_at && (
          <span style={{ marginLeft: "var(--sp-2)", fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
            {data.cached ? "cached · " : ""}
            {new Date(data.analyzed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
          <button
            onClick={analyze}
            disabled={analyzing}
            style={{
              padding: "3px 12px", borderRadius: "var(--r-sm)", border: "none",
              background: analyzing ? "var(--color-surface-raised)" : "var(--color-accent)",
              color: "#fff", fontSize: 11, fontWeight: 600,
              cursor: analyzing ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {analyzing ? <><Loader2 size={11} className="sj-spin" /> Analyzing…</> : <><Sparkles size={11} /> Re-Prioritize</>}
          </button>
        </div>
      </div>

      {/* Urgency breakdown strip */}
      {ranked.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderBottom: "var(--border)", flexShrink: 0 }}>
          {(["critical", "high", "medium", "low"] as Urgency[]).map(u => (
            <div
              key={u}
              onClick={() => setFilter(f => f === u ? "all" : u)}
              style={{ padding: "var(--sp-2)", textAlign: "center", background: filter === u ? `${URGENCY_META[u].color}10` : "var(--color-bg)", cursor: "pointer", borderBottom: filter === u ? `2px solid ${URGENCY_META[u].color}` : "2px solid transparent" }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: URGENCY_META[u].color }}>{counts[u]}</div>
              <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{u}</div>
            </div>
          ))}
        </div>
      )}

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : ranked.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-3)" }}>
            <div style={{ fontSize: 40 }}>✨</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>No priority data yet</p>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", maxWidth: 300 }}>
              Click Re-Prioritize to have AI rank your open tasks by urgency and impact.
            </p>
            <button onClick={analyze} disabled={analyzing} style={{ padding: "8px 20px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--sp-2)", margin: "0 auto" }}>
              {analyzing ? <><Loader2 size={12} className="sj-spin" /> Analyzing…</> : <><Sparkles size={12} /> Prioritize My Tasks</>}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {filtered.map((task, idx) => {
              const due = fmtDate(task.due_date);
              return (
                <div key={task.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text-muted)", flexShrink: 0, minWidth: 20, marginTop: 1 }}>
                    {filter === "all" ? task.rank : idx + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>{task.title}</span>
                      <UrgencyBadge urgency={task.urgency} />
                      {due && (
                        <span style={{ fontSize: 9, color: due.color, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{due.label}</span>
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>{task.reason}</p>
                  </div>
                </div>
              );
            })}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
