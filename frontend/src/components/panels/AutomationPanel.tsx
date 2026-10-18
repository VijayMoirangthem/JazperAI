"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

const API = "http://localhost:8000/api/automation";

interface Condition { field: string; op: string; value: string | string[] }
interface Action { type: string; params: Record<string, string> }
interface Rule {
  id: string; name: string; trigger_event: string;
  conditions: Condition[]; actions: Action[];
  enabled: boolean; run_count: number;
  last_fired_at: string | null; created_at: string;
}
interface Template {
  name: string; trigger_event: string;
  conditions: Condition[]; actions: Action[];
}
interface HistoryEntry {
  id: number; rule_id: string; rule_name: string;
  actions_fired: string[]; success: boolean;
  error_msg: string | null; fired_at: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  email_classified:   "Email Classified",
  job_status_changed: "Job Status Changed",
  new_notification:   "New Notification",
};

const ACTION_LABELS: Record<string, string> = {
  create_task:         "📋 Create Task",
  send_telegram:       "📱 Send Telegram",
  create_notification: "🔔 Notification",
};

function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return "< 1h ago";
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

type PanelTab = "rules" | "history";

const PILL: (active: boolean) => React.CSSProperties = (active) => ({
  padding: "3px 12px", borderRadius: "var(--r-full)", border: "none",
  cursor: "pointer", fontSize: 11, fontWeight: 500,
  background: active ? "var(--color-accent)" : "transparent",
  color: active ? "#fff" : "var(--color-text-muted)",
  transition: "background 0.15s",
});

export function AutomationPanel() {
  const [tab, setTab] = useState<PanelTab>("rules");
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [installingIdx, setInstallingIdx] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchRules() {
    setLoadingRules(true);
    try {
      const r = await fetch(API);
      const data = await r.json();
      setRules(Array.isArray(data) ? data : (data.rules ?? []));
    } catch { setRules([]); }
    finally { setLoadingRules(false); }
  }

  async function fetchTemplates() {
    try {
      const r = await fetch(`${API}/templates`);
      const data = await r.json();
      setTemplates(Array.isArray(data) ? data : (data.templates ?? []));
    } catch { setTemplates([]); }
  }

  async function fetchHistory() {
    setLoadingHistory(true);
    try {
      const r = await fetch(`${API}/history`);
      const data = await r.json();
      setHistory(Array.isArray(data) ? data : (data.entries ?? []));
    } catch { setHistory([]); }
    finally { setLoadingHistory(false); }
  }

  useEffect(() => {
    fetchRules();
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (tab === "history") fetchHistory();
  }, [tab]);

  async function toggleRule(id: string, enabled: boolean) {
    setTogglingId(id);
    try {
      await fetch(`${API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r));
    } finally { setTogglingId(null); }
  }

  async function deleteRule(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${API}/${id}`, { method: "DELETE" });
      setRules(prev => prev.filter(r => r.id !== id));
    } finally { setDeletingId(null); }
  }

  async function installTemplate(index: number) {
    setInstallingIdx(index);
    try {
      await fetch(`${API}/templates/${index}/install`, { method: "POST" });
      await fetchRules();
    } finally { setInstallingIdx(null); }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <Zap size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Automation Rules</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button style={PILL(tab === "rules")} onClick={() => setTab("rules")}>Rules</button>
          <button style={PILL(tab === "history")} onClick={() => setTab("history")}>History</button>
        </div>
      </div>

      {/* Body */}
      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto", padding: "var(--sp-3) var(--sp-4)" }}>

        {/* ── RULES TAB ── */}
        {tab === "rules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>

            {loadingRules && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading rules…</p>
            )}

            {!loadingRules && rules.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No automation rules yet. Install a template below.</p>
            )}

            {rules.map(rule => (
              <div key={rule.id} className="sj-card" style={{ opacity: rule.enabled ? 1 : 0.6, transition: "opacity 0.15s" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
                      {rule.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 7px",
                        borderRadius: "var(--r-full)",
                        background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                        color: "var(--color-accent)", border: "1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)",
                      }}>
                        {TRIGGER_LABELS[rule.trigger_event] ?? rule.trigger_event}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        Run {rule.run_count}×
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        Last: {relativeTime(rule.last_fired_at)}
                      </span>
                    </div>
                    {rule.actions.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {rule.actions.map((a, i) => (
                          <span key={i} style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: "var(--r-sm)",
                            background: "var(--color-surface-float)",
                            border: "var(--color-border-lo) 1px solid",
                            color: "var(--color-text-muted)",
                          }}>
                            {ACTION_LABELS[a.type] ?? a.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {/* Toggle */}
                    <button
                      onClick={() => toggleRule(rule.id, !rule.enabled)}
                      disabled={togglingId === rule.id}
                      title={rule.enabled ? "Disable" : "Enable"}
                      style={{
                        width: 36, height: 20, borderRadius: "var(--r-full)",
                        border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
                        background: rule.enabled ? "var(--color-accent)" : "var(--color-surface-float)",
                        opacity: togglingId === rule.id ? 0.5 : 1,
                        transition: "background 0.15s",
                      }}
                    >
                      <span style={{
                        position: "absolute", top: 3,
                        left: rule.enabled ? 19 : 3,
                        width: 14, height: 14, borderRadius: "var(--r-full)",
                        background: rule.enabled ? "#fff" : "var(--color-text-muted)",
                        transition: "left 0.15s",
                      }} />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => deleteRule(rule.id)}
                      disabled={deletingId === rule.id}
                      title="Delete rule"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#ef4444", fontSize: 16, lineHeight: 1, padding: 2,
                        opacity: deletingId === rule.id ? 0.4 : 0.7,
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Templates section */}
            {templates.length > 0 && (
              <>
                <div style={{ marginTop: "var(--sp-2)", borderTop: "var(--border)", paddingTop: "var(--sp-3)" }}>
                  <p className="sj-label" style={{ marginBottom: "var(--sp-2)" }}>Install Template</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                    {templates.map((tpl, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: "var(--sp-3)",
                        padding: "var(--sp-2) var(--sp-3)",
                        background: "var(--color-surface-raised)",
                        borderRadius: "var(--r-md)", border: "var(--border)",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text)" }}>
                            {tpl.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                            {TRIGGER_LABELS[tpl.trigger_event] ?? tpl.trigger_event}
                            {" → "}
                            {tpl.actions.map(a => ACTION_LABELS[a.type] ?? a.type).join(", ")}
                          </div>
                        </div>
                        <button
                          onClick={() => installTemplate(i)}
                          disabled={installingIdx === i}
                          style={{
                            padding: "4px 12px", borderRadius: "var(--r-sm)",
                            background: "var(--color-accent)", border: "none",
                            color: "#fff", fontSize: 11, cursor: "pointer",
                            opacity: installingIdx === i ? 0.5 : 1, flexShrink: 0,
                          }}
                        >
                          {installingIdx === i ? "Installing…" : "Install"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {loadingHistory && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading history…</p>
            )}
            {!loadingHistory && history.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No automation events yet.</p>
            )}
            {history.map(entry => (
              <div key={entry.id} style={{
                display: "flex", alignItems: "flex-start", gap: "var(--sp-2)",
                padding: "var(--sp-2) var(--sp-3)",
                background: "var(--color-surface-raised)", borderRadius: "var(--r-md)",
                border: "var(--border)",
              }}>
                <span style={{
                  fontSize: 14, flexShrink: 0, marginTop: 1,
                  color: entry.success ? "#22c55e" : "#ef4444",
                }}>
                  {entry.success ? "✓" : "✗"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text)" }}>
                    {entry.rule_name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
                    {entry.actions_fired.map(a => ACTION_LABELS[a] ?? a).join(", ") || "—"}
                  </div>
                  {entry.error_msg && (
                    <div style={{ fontSize: 11, color: "#f87171", marginTop: 2 }}>{entry.error_msg}</div>
                  )}
                </div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {relativeTime(entry.fired_at)}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
