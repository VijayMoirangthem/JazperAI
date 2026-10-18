"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, Zap, Bell, CalendarDays } from "lucide-react";

const API = "http://localhost:8000";

interface TimelineEntry {
  type: "automation" | "job_run" | "notification";
  ts: string | null;
  title: string;
  detail: string;
  color: string;
}

function groupByDay(entries: TimelineEntry[]): Record<string, TimelineEntry[]> {
  const groups: Record<string, TimelineEntry[]> = {};
  for (const e of entries) {
    const day = e.ts ? e.ts.slice(0, 10) : "unknown";
    if (!groups[day]) groups[day] = [];
    groups[day].push(e);
  }
  return groups;
}

function fmtDay(dateStr: string): string {
  if (dateStr === "unknown") return "Unknown Date";
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function fmtTime(ts: string): string {
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  automation:   <Zap size={11} />,
  job_run:      <CalendarDays size={11} />,
  notification: <Bell size={11} />,
};

const TYPE_LABEL: Record<string, string> = {
  automation:   "Rule fired",
  job_run:      "Job ran",
  notification: "Alert",
};

export function ActivityTimelinePanel() {
  const [entries, setEntries]   = useState<TimelineEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/activity?limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = groupByDay(entries);
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Activity size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Agent Activity Timeline</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)" }}>
          {entries.length} events
        </span>
        <button
          onClick={load}
          title="Refresh"
          style={{
            background: "none", border: "none", cursor: "pointer",
            marginLeft: "var(--sp-2)", color: "var(--color-icon)", display: "flex",
          }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading && entries.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", padding: "var(--sp-4)", textAlign: "center" }}>
            Loading…
          </p>
        ) : error ? (
          <p style={{ fontSize: 12, color: "#ef4444", padding: "var(--sp-4)", textAlign: "center" }}>
            {error}
          </p>
        ) : entries.length === 0 ? (
          <div style={{ padding: "var(--sp-6)", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: "var(--sp-3)" }}>📋</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              No agent activity yet. Jazper will start logging as it works.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {days.map(day => (
              <div key={day}>
                {/* Day header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "var(--sp-2)",
                  padding: "var(--sp-2) var(--sp-3)",
                  position: "sticky", top: 0,
                  background: "var(--color-bg)", zIndex: 1,
                  borderBottom: "1px solid var(--color-border)",
                  borderTop: "1px solid var(--color-border)",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>
                    {fmtDay(day)}
                  </span>
                  <span style={{
                    fontSize: 10, color: "var(--color-text-muted)",
                    background: "var(--color-surface-raised)", borderRadius: "var(--r-full)",
                    padding: "1px 6px", border: "1px solid var(--color-border)",
                  }}>
                    {grouped[day].length}
                  </span>
                </div>

                {grouped[day].map((entry, idx) => {
                  const entryKey = days.indexOf(day) * 1000 + idx;
                  const isOpen = expanded.has(entryKey);
                  const hasDetail = Boolean(entry.detail && entry.detail.trim());

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (!hasDetail) return;
                        setExpanded(prev => {
                          const next = new Set(prev);
                          if (next.has(entryKey)) next.delete(entryKey);
                          else next.add(entryKey);
                          return next;
                        });
                      }}
                      style={{
                        display: "flex", gap: "var(--sp-3)",
                        padding: "var(--sp-2) var(--sp-3)",
                        borderBottom: "1px solid var(--color-border-lo)",
                        cursor: hasDetail ? "pointer" : "default",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { if (hasDetail) (e.currentTarget as HTMLElement).style.background = "var(--color-surface-raised)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      {/* Icon */}
                      <div style={{
                        width: 24, height: 24, borderRadius: "var(--r-full)", flexShrink: 0,
                        background: `color-mix(in srgb, ${entry.color} 15%, transparent)`,
                        border: `1px solid ${entry.color}44`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: entry.color, marginTop: 2,
                      }}>
                        {TYPE_ICON[entry.type] || <Activity size={11} />}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: 2 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                            color: entry.color,
                            background: `color-mix(in srgb, ${entry.color} 12%, transparent)`,
                            padding: "1px 5px", borderRadius: "var(--r-full)",
                          }}>
                            {TYPE_LABEL[entry.type] || entry.type}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginLeft: "auto", flexShrink: 0 }}>
                            {entry.ts ? fmtTime(entry.ts) : ""}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-text)", fontWeight: 500, marginBottom: hasDetail ? 2 : 0 }}>
                          {entry.title}
                        </div>
                        {hasDetail && (
                          <div style={{
                            fontSize: 11, color: "var(--color-text-muted)",
                            overflow: "hidden",
                            maxHeight: isOpen ? 200 : "1.4em",
                            transition: "max-height 0.2s ease",
                            lineHeight: 1.4,
                          }}>
                            {entry.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
