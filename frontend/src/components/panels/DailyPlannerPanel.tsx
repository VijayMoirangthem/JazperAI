"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanContext {
  tasks_due_today: { title: string; priority: string }[];
  tasks_overdue: { title: string; priority: string }[];
  applications_active: number;
  unread_notifications: number;
}

interface PlanResponse {
  plan: string;
  context: PlanContext;
  cached: boolean;
  generated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeMinutes(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderPlan(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("## ")) {
      return (
        <div key={i} style={{
          fontWeight: 700,
          fontSize: 13,
          color: "var(--color-text)",
          borderLeft: "3px solid var(--color-accent)",
          paddingLeft: 10,
          marginTop: 18,
          marginBottom: 6,
          lineHeight: 1.4,
        }}>
          {line.slice(3)}
        </div>
      );
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return (
        <div key={i} style={{
          display: "flex", gap: 8, fontSize: 12,
          color: "var(--color-text)", marginBottom: 4, alignItems: "flex-start",
        }}>
          <span style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 2, lineHeight: 1 }}>•</span>
          <span style={{ lineHeight: 1.6 }}>{line.slice(2)}</span>
        </div>
      );
    }
    const numbered = line.match(/^(\d+)\.\s(.*)/);
    if (numbered) {
      return (
        <div key={i} style={{
          display: "flex", gap: 8, fontSize: 12,
          color: "var(--color-text)", marginBottom: 4, alignItems: "flex-start",
        }}>
          <span style={{
            color: "var(--color-accent)", flexShrink: 0,
            fontWeight: 600, minWidth: 18, lineHeight: 1.6,
          }}>
            {numbered[1]}.
          </span>
          <span style={{ lineHeight: 1.6 }}>{numbered[2]}</span>
        </div>
      );
    }
    if (line.trim() === "") {
      return <br key={i} />;
    }
    return (
      <p key={i} style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 4, lineHeight: 1.6 }}>
        {line}
      </p>
    );
  });
}

// ── Weekly review types ───────────────────────────────────────────────────────

interface WeekResponse {
  review: string;
  cached: boolean;
  generated_at: string;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function DailyPlannerPanel() {
  const [tab, setTab]           = useState<"today" | "week">("today");
  const [plan, setPlan]         = useState<PlanResponse | null>(null);
  const [week, setWeek]         = useState<WeekResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [weekLoading, setWeekLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);

  const fetchPlan = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API}/api/planner/today${force ? "?force=true" : ""}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      setPlan(await r.json());
    } catch {
      setError("Could not generate plan — is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWeek = useCallback(async (force = false) => {
    setWeekLoading(true);
    setWeekError(null);
    try {
      const url = `${API}/api/planner/week${force ? "?force=true" : ""}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      setWeek(await r.json());
    } catch {
      setWeekError("Could not generate weekly review — is the backend running?");
    } finally {
      setWeekLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);
  useEffect(() => { if (tab === "week" && !week) fetchWeek(); }, [tab, week, fetchWeek]);

  const ctx = plan?.context;

  return (
    <div className="sj-panel" style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0, overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header" style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
      }}>
        <CalendarDays size={14} style={{ color: "var(--color-accent)" }} />
        <span className="sj-label" style={{ fontWeight: 700, fontSize: 14 }}>Planner</span>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 2, marginLeft: "var(--sp-3)" }}>
          {(["today", "week"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "3px 10px", borderRadius: "var(--r-sm)", fontSize: 11,
              background: tab === t ? "var(--color-accent)" : "transparent",
              border: tab === t ? "none" : "var(--border)",
              color: tab === t ? "#fff" : "var(--color-text-muted)",
              cursor: "pointer", textTransform: "capitalize",
            }}>
              {t === "today" ? "Today" : "Week"}
            </button>
          ))}
        </div>

        {(tab === "today" ? plan?.cached : week?.cached) && (
          <span style={{
            fontSize: 10, color: "var(--color-text-muted)",
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            borderRadius: 8, padding: "2px 7px",
          }}>
            cached
          </span>
        )}
        <button
          onClick={() => tab === "today" ? fetchPlan(true) : fetchWeek(true)}
          disabled={tab === "today" ? loading : weekLoading}
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 6, fontSize: 11,
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            cursor: (tab === "today" ? loading : weekLoading) ? "not-allowed" : "pointer",
            color: "var(--color-text-muted)", opacity: (tab === "today" ? loading : weekLoading) ? 0.6 : 1,
          }}
        >
          <RefreshCw size={11} className={(tab === "today" ? loading : weekLoading) ? "sj-spin" : ""} />
          Regenerate
        </button>
      </div>

      {/* Context pills — today only */}
      {tab === "today" && ctx && (
        <div style={{
          display: "flex", gap: 6, flexWrap: "wrap",
          padding: "8px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
        }}>
          {ctx.tasks_due_today.length > 0 && (
            <span style={{
              fontSize: 11, padding: "2px 9px", borderRadius: 10,
              background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44",
            }}>
              {ctx.tasks_due_today.length} due today
            </span>
          )}
          {ctx.tasks_overdue.length > 0 && (
            <span style={{
              fontSize: 11, padding: "2px 9px", borderRadius: 10,
              background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444",
            }}>
              {ctx.tasks_overdue.length} overdue
            </span>
          )}
          {ctx.applications_active > 0 && (
            <span style={{
              fontSize: 11, padding: "2px 9px", borderRadius: 10,
              background: "#60a5fa22", color: "#60a5fa", border: "1px solid #60a5fa44",
            }}>
              {ctx.applications_active} apps active
            </span>
          )}
          {ctx.unread_notifications > 0 && (
            <span style={{
              fontSize: 11, padding: "2px 9px", borderRadius: 10,
              background: "#a78bfa22", color: "#a78bfa", border: "1px solid #a78bfa44",
            }}>
              {ctx.unread_notifications} unread
            </span>
          )}
          {ctx.tasks_due_today.length === 0 &&
           ctx.tasks_overdue.length === 0 &&
           ctx.applications_active === 0 &&
           ctx.unread_notifications === 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>All clear today</span>
          )}
        </div>
      )}

      {/* Body — scrollable */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {tab === "today" ? (
          loading && !plan ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-text-muted)", fontSize: 13 }}>
              <RefreshCw size={14} className="sj-spin" /> Generating your daily plan…
            </div>
          ) : error ? (
            <div style={{ fontSize: 13, color: "#ef4444" }}>{error}</div>
          ) : plan ? renderPlan(plan.plan) : null
        ) : (
          weekLoading && !week ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-text-muted)", fontSize: 13 }}>
              <RefreshCw size={14} className="sj-spin" /> Generating weekly review…
            </div>
          ) : weekError ? (
            <div style={{ fontSize: 13, color: "#ef4444" }}>{weekError}</div>
          ) : week ? renderPlan(week.review) : null
        )}
      </div>

      {/* Footer */}
      {((tab === "today" && plan) || (tab === "week" && week)) && (
        <div style={{
          padding: "6px 16px", borderTop: "1px solid var(--color-border)",
          textAlign: "right", flexShrink: 0,
        }}>
          <span className="sj-micro" style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            Generated {relativeMinutes(tab === "today" ? plan!.generated_at : week!.generated_at)}
          </span>
        </div>
      )}
    </div>
  );
}
