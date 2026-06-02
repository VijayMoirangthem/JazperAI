"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, CheckCircle2, MessageSquare, Brain, Clock, RefreshCw, AlertTriangle } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_MS = 30_000;

interface DashboardStats {
  uptime_seconds: number;
  tasks: { pending: number; done: number; due_today: number; overdue: number };
  memory: { core: number; extracted: number; auto: number };
  chat: { sessions: number; messages_today: number };
  services: Record<string, string>;
  unread_notifications?: number;
}

function fmtUptime(s: number): string {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SERVICE_LABELS: Record<string, string> = {
  database:  "PostgreSQL",
  lm_studio: "LM Studio",
};

export function DashboardPanel() {
  const [stats, setStats]     = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/dashboard/stats`);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      setStats(data);
      setLastSync(new Date());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const s = stats;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Activity size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Overview</span>
        <span className="sj-badge sj-badge-live sj-ml-auto">Live</span>
        <button
          onClick={load}
          title="Refresh"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: "var(--sp-2)", color: "var(--color-icon)", display: "flex", alignItems: "center" }}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="sj-panel-body sj-flex-col sj-gap-3" style={{ flex: 1, overflowY: "auto" }}>

        {loading ? (
          <p className="sj-micro">Loading dashboard...</p>
        ) : !s ? (
          <div className="sj-card" style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <AlertTriangle size={13} style={{ color: "#e25c5c" }} />
            <span className="sj-micro">Could not reach backend. Is it running?</span>
          </div>
        ) : (
          <>
            {/* Uptime */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <Clock size={11} style={{ color: "var(--color-icon)" }} />
              <span className="sj-micro">Uptime: <b style={{ color: "var(--color-text)" }}>{fmtUptime(s.uptime_seconds)}</b></span>
              {lastSync && (
                <span className="sj-micro" style={{ marginLeft: "auto" }}>
                  synced {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
            </div>

            {/* Metric grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
              <div className="sj-metric-card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                  <CheckCircle2 size={11} style={{ color: "var(--color-icon)" }} />
                  <span className="sj-label">Tasks</span>
                </div>
                <div className="sj-metric">{s.tasks.pending + s.tasks.done}</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>
                  {s.tasks.pending} pending · {s.tasks.done} done
                </div>
                {s.tasks.overdue > 0 && (
                  <div style={{ fontSize: 10, color: "#e25c5c", marginTop: 2 }}>
                    ⚠ {s.tasks.overdue} overdue
                  </div>
                )}
                {s.tasks.due_today > 0 && (
                  <div style={{ fontSize: 10, color: "#e2a94b", marginTop: 2 }}>
                    {s.tasks.due_today} due today
                  </div>
                )}
              </div>

              <div className="sj-metric-card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                  <Brain size={11} style={{ color: "var(--color-icon)" }} />
                  <span className="sj-label">Memory</span>
                </div>
                <div className="sj-metric">{s.memory.core + s.memory.extracted}</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>
                  {s.memory.core} core · {s.memory.extracted} extracted
                </div>
              </div>

              <div className="sj-metric-card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                  <MessageSquare size={11} style={{ color: "var(--color-icon)" }} />
                  <span className="sj-label">Chat</span>
                </div>
                <div className="sj-metric">{s.chat.messages_today}</div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>
                  messages today
                </div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>
                  {s.chat.sessions} active sessions
                </div>
              </div>

              <div className="sj-metric-card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                  <Activity size={11} style={{ color: "var(--color-icon)" }} />
                  <span className="sj-label">Alerts</span>
                </div>
                <div className="sj-metric" style={{ color: (s.unread_notifications ?? 0) > 0 ? "#e2a94b" : undefined }}>
                  {s.unread_notifications ?? 0}
                </div>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>
                  unread notifications
                </div>
              </div>
            </div>

            {/* System status */}
            <div className="sj-card">
              <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-3)" }}>
                System Status
              </span>
              <div className="sj-flex-col sj-gap-1">
                {Object.entries(s.services).map(([key, status]) => (
                  <div key={key} className="sj-feed-item">
                    <span className={`sj-dot sj-dot-${status === "online" ? "active" : "live"}`} />
                    <span className="sj-feed-label">{SERVICE_LABELS[key] ?? key}</span>
                    <span className="sj-micro" style={{ marginLeft: "auto", color: status === "online" ? "var(--color-accent)" : "#e25c5c" }}>
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tasks breakdown */}
            {(s.tasks.pending + s.tasks.done) > 0 && (
              <div className="sj-card">
                <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-2)" }}>Task Breakdown</span>
                <div style={{ display: "flex", gap: 2, borderRadius: 4, overflow: "hidden", height: 8 }}>
                  {s.tasks.done > 0 && (
                    <div style={{ flex: s.tasks.done, background: "var(--color-accent)" }} title={`${s.tasks.done} done`} />
                  )}
                  {s.tasks.pending > 0 && (
                    <div style={{ flex: s.tasks.pending, background: "var(--color-surface-3)" }} title={`${s.tasks.pending} pending`} />
                  )}
                </div>
                <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-1)" }}>
                  <span className="sj-micro"><span style={{ color: "var(--color-accent)" }}>■</span> Done ({s.tasks.done})</span>
                  <span className="sj-micro"><span style={{ color: "var(--color-text-muted)" }}>■</span> Pending ({s.tasks.pending})</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
