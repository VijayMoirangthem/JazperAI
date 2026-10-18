"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart2, RefreshCw, TrendingUp, DollarSign, ChevronRight } from "lucide-react";

const API = "http://localhost:8000";

interface FunnelStage { status: string; count: number; pct: number }
interface FunnelData {
  total: number;
  stages: FunnelStage[];
  conversion: { applied_to_response: number; response_to_interview: number; interview_to_offer: number };
  avg_days_to_response: number | null;
}
interface SalaryEntry { company: string; role: string; salary_min: number | null; salary_max: number | null }
interface SalaryData { entries: SalaryEntry[]; avg_min: number | null; avg_max: number | null; note?: string }

const STAGE_META: Record<string, { label: string; color: string }> = {
  applied:   { label: "Applied",    color: "#6366f1" },
  viewed:    { label: "Viewed",     color: "#3b82f6" },
  response:  { label: "Response",   color: "#f59e0b" },
  interview: { label: "Interview",  color: "#22c55e" },
  offer:     { label: "Offer",      color: "#10b981" },
  rejected:  { label: "Rejected",   color: "#ef4444" },
};

function fmt(n: number | null | undefined, suffix = "%") {
  if (n == null) return "—";
  return `${Math.round(n)}${suffix}`;
}

function FunnelBar({ stages, total }: { stages: FunnelStage[]; total: number }) {
  const active = stages.filter(s => s.status !== "rejected");
  if (!active.length) return null;
  const max = Math.max(...active.map(s => s.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      {active.map(s => {
        const meta = STAGE_META[s.status] || { label: s.status, color: "#6b7280" };
        const barW = Math.max(4, (s.count / max) * 100);
        return (
          <div key={s.status} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <div style={{ width: 64, fontSize: 11, color: "var(--color-text-muted)", textAlign: "right", flexShrink: 0 }}>
              {meta.label}
            </div>
            <div style={{ flex: 1, height: 18, background: "var(--color-surface-raised)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${barW}%`, background: meta.color,
                borderRadius: "var(--r-sm)", transition: "width 0.5s ease",
                display: "flex", alignItems: "center", paddingLeft: 6,
              }}>
                {s.count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", whiteSpace: "nowrap" }}>{s.count}</span>
                )}
              </div>
            </div>
            <div style={{ width: 36, fontSize: 10, color: "var(--color-text-muted)", textAlign: "right", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
              {total > 0 ? `${Math.round(s.count / total * 100)}%` : "0%"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AppFunnelPanel() {
  const [funnel, setFunnel]       = useState<FunnelData | null>(null);
  const [salary, setSalary]       = useState<SalaryData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"funnel" | "salary">("funnel");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, sRes] = await Promise.all([
        fetch(`${API}/api/apply/funnel`),
        fetch(`${API}/api/apply/salary`),
      ]);
      if (fRes.ok) setFunnel(await fRes.json());
      if (sRes.ok) setSalary(await sRes.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <BarChart2 size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Application Intelligence</span>
        <button
          onClick={load}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0 }}>
        {(["funnel", "salary"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "4px 12px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
            border: "none", cursor: "pointer", textTransform: "capitalize",
            background: tab === t ? "var(--color-surface-raised)" : "none",
            color: tab === t ? "var(--color-text)" : "var(--color-text-muted)",
          }}>{t}</button>
        ))}
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : tab === "funnel" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {!funnel || funnel.total === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>📊</div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No applications yet. Apply to jobs to see your funnel.</p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-2)" }}>
                  {[
                    { label: "Total Applied", value: funnel.total },
                    { label: "Avg Days to Response", value: funnel.avg_days_to_response != null ? `${Math.round(funnel.avg_days_to_response)}d` : "—" },
                    { label: "Interview Rate", value: fmt(funnel.conversion.applied_to_response) },
                  ].map(c => (
                    <div key={c.label} className="sj-metric-card" style={{ padding: "var(--sp-3)" }}>
                      <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-1)", fontSize: 9 }}>{c.label}</span>
                      <div className="sj-metric" style={{ fontSize: 20 }}>{c.value}</div>
                    </div>
                  ))}
                </div>

                {/* Funnel chart */}
                <div className="sj-card">
                  <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-3)" }}>Application Funnel</span>
                  <FunnelBar stages={funnel.stages} total={funnel.total} />
                </div>

                {/* Conversion rates */}
                <div className="sj-card">
                  <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-3)" }}>Conversion Rates</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                    {[
                      { label: "Applied → Response",  value: funnel.conversion.applied_to_response,   color: "#f59e0b" },
                      { label: "Response → Interview", value: funnel.conversion.response_to_interview, color: "#22c55e" },
                      { label: "Interview → Offer",    value: funnel.conversion.interview_to_offer,    color: "#10b981" },
                    ].map(r => (
                      <div key={r.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "var(--color-text)", display: "flex", alignItems: "center", gap: 4 }}>
                            <ChevronRight size={10} style={{ color: r.color }} /> {r.label}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: r.color, fontFamily: "var(--font-mono)" }}>{fmt(r.value)}</span>
                        </div>
                        <div style={{ height: 4, background: "var(--color-surface-raised)", borderRadius: "var(--r-full)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(r.value || 0, 100)}%`, background: r.color, borderRadius: "var(--r-full)", transition: "width 0.5s" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rejected count */}
                {funnel.stages.find(s => s.status === "rejected") && (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
                    {funnel.stages.find(s => s.status === "rejected")?.count} rejections so far — keep going 💪
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* Salary tab */
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {salary?.note || !salary?.entries?.length ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>💰</div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  {salary?.note || "No salary data recorded yet. Add salary ranges when logging applications."}
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
                  {[
                    { label: "Avg Min Salary", value: salary.avg_min != null ? `$${Math.round(salary.avg_min).toLocaleString()}` : "—" },
                    { label: "Avg Max Salary", value: salary.avg_max != null ? `$${Math.round(salary.avg_max).toLocaleString()}` : "—" },
                  ].map(c => (
                    <div key={c.label} className="sj-metric-card">
                      <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-1)" }}>{c.label}</span>
                      <div className="sj-metric" style={{ fontSize: 20 }}>{c.value}</div>
                    </div>
                  ))}
                </div>
                <div className="sj-card">
                  <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-3)" }}>
                    <DollarSign size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    Salary Data by Role
                  </span>
                  {salary.entries.map((e, i) => (
                    <div key={i} style={{ padding: "var(--sp-2) 0", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--color-text)", fontWeight: 500 }}>{e.company}</div>
                        <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{e.role}</div>
                      </div>
                      <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#22c55e", flexShrink: 0 }}>
                        {e.salary_min && e.salary_max
                          ? `$${Math.round(e.salary_min / 1000)}k–$${Math.round(e.salary_max / 1000)}k`
                          : e.salary_min ? `$${Math.round(e.salary_min / 1000)}k+` : "—"
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ height: "var(--sp-4)" }} />
      </div>
    </div>
  );
}
