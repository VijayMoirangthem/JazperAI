"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";

const API = "http://localhost:8000";

interface AnalyticsData {
  total: number;
  by_type: Record<string, number>;
  by_day: { date: string; count: number }[];
  reply_count: number;
  automation_fires: number;
  peak_hour: string | null;
  unread_rate: number;
  error?: string;
}

const TYPE_COLOR: Record<string, string> = {
  email:           "#3b82f6",
  recruiter:       "#8b5cf6",
  interview:       "#f59e0b",
  offer:           "#22c55e",
  rejection:       "#ef4444",
  action_required: "#f97316",
  important:       "#ec4899",
};

const TYPE_LABEL: Record<string, string> = {
  email:           "Email",
  recruiter:       "Recruiter",
  interview:       "Interview",
  offer:           "Offer",
  rejection:       "Rejection",
  action_required: "Action Required",
  important:       "Important",
};

function SparkBar({ by_day }: { by_day: { date: string; count: number }[] }) {
  if (by_day.length === 0) return null;
  const max = Math.max(...by_day.map(d => d.count), 1);
  const W = 480, H = 80, BAR_W = Math.max(4, Math.floor(W / Math.max(by_day.length, 1)) - 2);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {by_day.map((d, i) => {
        const barH = Math.max(3, Math.round((d.count / max) * (H - 8)));
        const x    = Math.round((i / by_day.length) * W);
        return (
          <rect
            key={d.date}
            x={x} y={H - barH} width={BAR_W} height={barH}
            fill="var(--color-accent)" fillOpacity={0.65}
            rx={2}
          />
        );
      })}
    </svg>
  );
}

export function EmailAnalyticsPanel() {
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays]       = useState(30);

  const load = useCallback(async (d = days) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/email-analytics?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(days); }, [load, days]);

  // Trend: compare first half vs second half of by_day
  function getTrend(): "up" | "down" | "neutral" {
    if (!data || data.by_day.length < 4) return "neutral";
    const half = Math.floor(data.by_day.length / 2);
    const first  = data.by_day.slice(0, half).reduce((s, d) => s + d.count, 0);
    const second = data.by_day.slice(half).reduce((s, d) => s + d.count, 0);
    if (second > first * 1.1) return "up";
    if (second < first * 0.9) return "down";
    return "neutral";
  }

  const trend = getTrend();
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : "var(--color-text-muted)";

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Mail size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Email Analytics</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <select
            value={days}
            onChange={e => setDays(parseInt(e.target.value))}
            style={{
              fontSize: 11, padding: "2px 6px", borderRadius: "var(--r-sm)",
              background: "var(--color-surface-raised)", border: "var(--border)",
              color: "var(--color-text-muted)", cursor: "pointer",
            }}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            onClick={() => load(days)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
          >
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
        </div>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading analytics…</p>
        ) : !data ? (
          <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", padding: "var(--sp-4)" }}>Failed to load analytics.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>

            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
              {[
                { label: "Total Emails", value: data.total, sub: `last ${days} days` },
                { label: "Unread Rate",  value: `${data.unread_rate}%`, sub: "of received" },
                { label: "Automations", value: data.automation_fires, sub: "rules fired" },
                { label: "Peak Hour",   value: data.peak_hour || "—", sub: "most activity" },
              ].map(card => (
                <div key={card.label} className="sj-metric-card">
                  <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-1)" }}>{card.label}</span>
                  <div className="sj-metric" style={{ fontSize: 22 }}>{card.value}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Volume trend chart */}
            {data.by_day.length > 0 && (
              <div className="sj-card" style={{ padding: "var(--sp-3) var(--sp-3) var(--sp-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
                  <span className="sj-label">Volume Trend</span>
                  <TrendIcon size={12} style={{ color: trendColor }} />
                  <span style={{ fontSize: 10, color: trendColor, marginLeft: 2 }}>
                    {trend === "up" ? "increasing" : trend === "down" ? "decreasing" : "stable"}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)" }}>
                    {data.by_day.length} days
                  </span>
                </div>
                <div style={{ height: 80, borderRadius: "var(--r-sm)", overflow: "hidden" }}>
                  <SparkBar by_day={data.by_day} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--sp-1)" }}>
                  <span style={{ fontSize: 9, color: "var(--color-text-muted)" }}>
                    {data.by_day[0]?.date || ""}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--color-text-muted)" }}>
                    {data.by_day[data.by_day.length - 1]?.date || "today"}
                  </span>
                </div>
              </div>
            )}

            {/* By type breakdown */}
            {Object.keys(data.by_type).length > 0 && (
              <div className="sj-card">
                <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-3)" }}>By Type</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {Object.entries(data.by_type)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => {
                      const color = TYPE_COLOR[type] || "#6b7280";
                      const pct   = data.total > 0 ? Math.round((count / data.total) * 100) : 0;
                      return (
                        <div key={type}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: "var(--color-text)" }}>
                                {TYPE_LABEL[type] || type}
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div style={{ height: 4, borderRadius: "var(--r-full)", background: "var(--color-surface-raised)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "var(--r-full)", transition: "width 0.4s" }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {data.total === 0 && (
              <div style={{ textAlign: "center", padding: "var(--sp-4)" }}>
                <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>📊</div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  No email data yet for the selected period. Connect Gmail and let Hermes monitor your inbox.
                </p>
              </div>
            )}

            <div style={{ height: "var(--sp-2)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
