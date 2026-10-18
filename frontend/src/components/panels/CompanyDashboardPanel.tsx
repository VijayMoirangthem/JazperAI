"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, Power, Eye, Ban, RefreshCw } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface KPIs {
  active_agents:   number;
  total_agents:    number;
  tasks_today:     number;
  tasks_done_today: number;
  messages_today:  number;
  errors_today:    number;
  open_tickets:    number;
  actions_today:   number;
}

interface Department {
  name:            string;
  id:              string;
  active:          number;
  standby:         number;
  total:           number;
  avg_health:      number;
  tasks_completed: number;
  tasks_failed:    number;
}

interface AutonomyAction {
  id:           string;
  category_id:  string;
  action_taken: string;
  reasoning:    string;
  outcome:      string | null;
  vj_reviewed:  boolean;
  created_at:   string | null;
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function CompanyDashboardPanel() {
  const [kpis,         setKpis]         = useState<KPIs | null>(null);
  const [departments,  setDepartments]  = useState<Department[]>([]);
  const [actions,      setActions]      = useState<AutonomyAction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [killActive,   setKillActive]   = useState(false);
  const [togglingDept, setTogglingDept] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [kr, dr, ar] = await Promise.all([
        fetch(`${API}/api/company/kpis`),
        fetch(`${API}/api/company/departments`),
        fetch(`${API}/api/agents/autonomy-log?limit=20`),
      ]);
      const [kd, dd, ad] = await Promise.all([kr.json(), dr.json(), ar.json()]);
      if (kd && typeof kd.active_agents === "number") setKpis(kd);
      if (dd?.departments) setDepartments(dd.departments);
      if (ad?.actions)     setActions(ad.actions);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function toggleKillSwitch() {
    if (!window.confirm(
      killActive
        ? "Re-enable all agents? This will set all L2+ agents back to active."
        : "Activate KILL SWITCH? This will put ALL non-executive agents into standby."
    )) return;
    const next = !killActive;
    try {
      await fetch(`${API}/api/company/kill-switch?enabled=${next}`, { method: "POST" });
      setKillActive(next);
      await load();
    } catch { /* silent */ }
  }

  async function toggleDept(deptId: string, currentlyActive: boolean) {
    setTogglingDept(deptId);
    try {
      await fetch(
        `${API}/api/company/departments/${deptId}/toggle?enabled=${!currentlyActive}`,
        { method: "POST" }
      );
      await load();
    } catch { /* silent */ }
    setTogglingDept(null);
  }

  async function reviewAction(actionId: string, vetoed: boolean) {
    try {
      await fetch(
        `${API}/api/agents/autonomy-log/${actionId}/review?vetoed=${vetoed}`,
        { method: "POST" }
      );
      setActions(prev => prev.map(a => a.id === actionId ? { ...a, vj_reviewed: true } : a));
    } catch { /* silent */ }
  }

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  const pendingCount = actions.filter(a => !a.vj_reviewed).length;

  return (
    <div className="sj-panel">
      {/* ── Header ── */}
      <div className="sj-panel-header">
        <Building2 size={14} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label" style={{ flex: 1 }}>Company Dashboard</span>
        {loading && (
          <RefreshCw size={11} style={{ color: "var(--color-icon)", animation: "spin 1s linear infinite" }} />
        )}
        {pendingCount > 0 && (
          <span className="sj-badge sj-badge-hi">{pendingCount} pending review</span>
        )}
        <button
          className={`sj-btn ${killActive ? "sj-btn-primary" : "sj-btn-outline"}`}
          onClick={toggleKillSwitch}
        >
          <Power size={12} />
          {killActive ? "Kill Switch: ON" : "Kill Switch"}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="sj-panel-body sj-flex-col sj-gap-3">

        {/* KPI metric cards — 4-up grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-2)" }}>
          <div className="sj-metric-card">
            <span className="sj-label">Active Agents</span>
            <div className="sj-metric">{kpis ? kpis.active_agents : "—"}</div>
            <span className="sj-micro">{kpis ? `of ${kpis.total_agents} total` : "loading…"}</span>
          </div>
          <div className="sj-metric-card">
            <span className="sj-label">Tasks Done</span>
            <div className="sj-metric">{kpis ? kpis.tasks_done_today : "—"}</div>
            <span className="sj-micro">{kpis ? `${kpis.tasks_today} started today` : "loading…"}</span>
          </div>
          <div className="sj-metric-card">
            <span className="sj-label">Errors Today</span>
            <div className="sj-metric">{kpis?.errors_today ?? "—"}</div>
            <span className="sj-micro">{kpis ? `${kpis.open_tickets} tickets open` : "loading…"}</span>
          </div>
          <div className="sj-metric-card">
            <span className="sj-label">Actions Today</span>
            <div className="sj-metric">{kpis?.actions_today ?? "—"}</div>
            <span className="sj-micro">{kpis ? `${kpis.messages_today} messages` : "loading…"}</span>
          </div>
        </div>

        {/* Department Scorecard */}
        <div className="sj-card" style={{ padding: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--sp-2)",
            padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border-lo)",
          }}>
            <span className="sj-label" style={{ flex: 1 }}>Department Scorecard</span>
            <span className="sj-micro">{departments.length} dept{departments.length !== 1 ? "s" : ""}</span>
          </div>

          {departments.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", textAlign: "center" }}>
              <p className="sj-micro">
                No departments registered yet — agents appear here once the registry is populated
              </p>
            </div>
          ) : (
            <div style={{ padding: "0 var(--sp-3)" }}>
              {departments.map((dept) => (
                <div key={dept.id} className="sj-feed-item">
                  <span className={`sj-dot ${dept.active > 0 ? "sj-dot-active" : "sj-dot-idle"}`} />
                  <span className="sj-feed-label">{dept.name}</span>
                  <span className="sj-micro" style={{ minWidth: 44 }}>{dept.active}/{dept.total} on</span>
                  <div style={{ width: 72 }}>
                    <div className="sj-bar">
                      <div className="sj-bar-fill" style={{ width: `${Math.min(100, dept.avg_health)}%` }} />
                    </div>
                  </div>
                  <span className="sj-micro" style={{ minWidth: 30, textAlign: "right" }}>
                    {dept.avg_health.toFixed(0)}%
                  </span>
                  <span className="sj-micro" style={{ minWidth: 44 }}>
                    {dept.tasks_completed}✓{dept.tasks_failed > 0 ? ` ${dept.tasks_failed}✗` : ""}
                  </span>
                  <button
                    className="sj-btn sj-btn-ghost"
                    style={{ padding: "2px var(--sp-2)", fontSize: 10, minWidth: 52 }}
                    onClick={() => toggleDept(dept.id, dept.active > 0)}
                    disabled={togglingDept === dept.id}
                  >
                    {togglingDept === dept.id ? "…" : dept.active > 0 ? "Standby" : "Enable"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Autonomy Log */}
        <div className="sj-card" style={{ padding: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--sp-2)",
            padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border-lo)",
          }}>
            <span className="sj-label" style={{ flex: 1 }}>Autonomy Log</span>
            {pendingCount > 0 && (
              <span className="sj-badge sj-badge-hi">{pendingCount} unreviewed</span>
            )}
          </div>

          {actions.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", textAlign: "center" }}>
              <p className="sj-micro">No autonomous actions recorded yet</p>
            </div>
          ) : (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {actions.map((action) => (
                <div
                  key={action.id}
                  className="sj-flex-col sj-gap-1"
                  style={{ padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border-lo)" }}
                >
                  {/* Row 1: badges + timestamp */}
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                    <span className={`sj-badge ${action.vj_reviewed ? "" : "sj-badge-hi"}`}>
                      {action.vj_reviewed ? "reviewed" : "pending"}
                    </span>
                    <span className="sj-badge">{action.category_id}</span>
                    <span className="sj-micro" style={{ marginLeft: "auto" }}>
                      {fmtTime(action.created_at)}
                    </span>
                  </div>

                  {/* Row 2: action text */}
                  <p
                    className="sj-body"
                    style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={action.action_taken}
                  >
                    {action.action_taken}
                  </p>

                  {/* Row 3: outcome (optional) */}
                  {action.outcome && (
                    <p className="sj-micro">{action.outcome}</p>
                  )}

                  {/* Row 4: review buttons (only when unreviewed) */}
                  {!action.vj_reviewed && (
                    <div style={{ display: "flex", gap: "var(--sp-1)" }}>
                      <button
                        className="sj-btn sj-btn-ghost"
                        style={{ padding: "2px var(--sp-2)", fontSize: 10 }}
                        onClick={() => reviewAction(action.id, false)}
                      >
                        <Eye size={10} /> Review
                      </button>
                      <button
                        className="sj-btn sj-btn-outline"
                        style={{ padding: "2px var(--sp-2)", fontSize: 10 }}
                        onClick={() => reviewAction(action.id, true)}
                      >
                        <Ban size={10} /> Veto
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
