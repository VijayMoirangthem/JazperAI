"use client";

import { useState, useEffect, useCallback } from "react";
import { Inbox, Zap, RefreshCw, Loader2, Mail } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type Priority = "critical" | "action" | "fyi" | "noise";

interface TriageEmail {
  id: string;
  title: string;
  message: string;
  created_at: string;
  triage_priority: Priority | null;
  triage_action: string | null;
  metadata?: { from_email?: string; subject?: string };
}

interface AnalyzeResult {
  analyzed: number;
  breakdown: Record<Priority, number>;
}

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  critical: { label: "Critical", color: "#ef4444", bg: "#ef444418" },
  action:   { label: "Action",   color: "#f59e0b", bg: "#f59e0b18" },
  fyi:      { label: "FYI",      color: "#3b82f6", bg: "#3b82f618" },
  noise:    { label: "Noise",    color: "#6b7280", bg: "#6b728018" },
};

const PRIORITY_ORDER: Priority[] = ["critical", "action", "fyi", "noise"];

function PriorityBadge({ p }: { p: Priority | null }) {
  if (!p) return <span style={{ fontSize: 9, color: "var(--color-text-muted)" }}>—</span>;
  const m = PRIORITY_META[p];
  return (
    <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: "var(--r-full)", background: m.bg, border: `1px solid ${m.color}44`, color: m.color, fontWeight: 700 }}>
      {m.label}
    </span>
  );
}

export function EmailTriagePanel() {
  const toast = useToast();

  const [emails, setEmails]         = useState<TriageEmail[]>([]);
  const [loading, setLoading]       = useState(true);
  const [analyzing, setAnalyzing]   = useState(false);
  const [lastResult, setLastResult] = useState<AnalyzeResult | null>(null);
  const [filter, setFilter]         = useState<Priority | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/triage/inbox`);
      if (res.ok) setEmails((await res.json()).notifications || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await fetch(`${API}/api/triage/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 30 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnalyzeResult = await res.json();
      setLastResult(data);
      toast(`Triaged ${data.analyzed} emails`, "success");
      load();
    } catch (e) {
      toast(`Analysis failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setAnalyzing(false); }
  }

  async function override(id: string, priority: Priority) {
    try {
      await fetch(`${API}/api/triage/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triage_priority: priority }),
      });
      setEmails(prev => prev.map(e => e.id === id ? { ...e, triage_priority: priority } : e));
    } catch { toast("Failed to update", "error"); }
  }

  function fmtDate(ts: string) {
    try { return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }); }
    catch { return ""; }
  }

  const filtered = filter === "all" ? emails : emails.filter(e => e.triage_priority === filter);
  const counts = PRIORITY_ORDER.reduce((acc, p) => {
    acc[p] = emails.filter(e => e.triage_priority === p).length;
    return acc;
  }, {} as Record<Priority, number>);
  const untriagedCount = emails.filter(e => !e.triage_priority).length;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Inbox size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Email Triage</span>
        {untriagedCount > 0 && (
          <span style={{ marginLeft: "var(--sp-2)", fontSize: 10, background: "#f59e0b18", border: "1px solid #f59e0b44", color: "#f59e0b", padding: "1px 7px", borderRadius: "var(--r-full)", fontWeight: 600 }}>
            {untriagedCount} untriaged
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
            {analyzing ? <><Loader2 size={11} className="sj-spin" /> Analyzing…</> : <><Zap size={11} /> AI Triage</>}
          </button>
        </div>
      </div>

      {/* Last analyze result */}
      {lastResult && (
        <div style={{ padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", background: "var(--color-surface-raised)", display: "flex", alignItems: "center", gap: "var(--sp-3)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Last scan: {lastResult.analyzed} emails</span>
          {PRIORITY_ORDER.map(p => lastResult.breakdown[p] > 0 && (
            <span key={p} style={{ fontSize: 10, color: PRIORITY_META[p].color, fontWeight: 600 }}>
              {lastResult.breakdown[p]} {PRIORITY_META[p].label}
            </span>
          ))}
        </div>
      )}

      {/* Priority filter tabs */}
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0, overflowX: "auto" }}>
        {(["all", ...PRIORITY_ORDER] as const).map(p => {
          const cnt = p === "all" ? emails.length : counts[p];
          const active = filter === p;
          const col = p === "all" ? "var(--color-accent)" : PRIORITY_META[p].color;
          return (
            <button
              key={p}
              onClick={() => setFilter(p)}
              style={{
                padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none",
                background: active ? "var(--color-surface-raised)" : "none",
                color: active ? "var(--color-text)" : "var(--color-text-muted)",
                fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {p !== "all" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, display: "inline-block" }} />}
              {p === "all" ? "All" : PRIORITY_META[p].label}
              {cnt > 0 && <span style={{ fontSize: 9, background: "var(--color-surface-raised)", padding: "1px 5px", borderRadius: "var(--r-full)", color: "var(--color-text-muted)" }}>{cnt}</span>}
            </button>
          );
        })}
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>📭</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {emails.length === 0 ? "No email notifications yet. Check back after emails arrive in your inbox." : `No ${filter} emails.`}
            </p>
            {emails.length === 0 && untriagedCount === 0 && (
              <button onClick={analyze} disabled={analyzing} style={{ marginTop: "var(--sp-3)", padding: "8px 20px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--sp-2)", margin: "var(--sp-3) auto 0" }}>
                <Zap size={12} /> Run AI Triage
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {filtered.map(email => {
              const subject = email.metadata?.subject || email.title;
              const from    = email.metadata?.from_email || "";
              return (
                <div key={email.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <Mail size={13} style={{ color: "var(--color-icon)", flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {subject}
                      </span>
                      <PriorityBadge p={email.triage_priority} />
                    </div>
                    {from && <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "0 0 2px", fontFamily: "var(--font-mono)" }}>{from}</p>}
                    {email.message && (
                      <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
                        {email.message.length > 120 ? email.message.slice(0, 120) + "…" : email.message}
                      </p>
                    )}
                    {email.triage_action && (
                      <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "3px 0 0", fontStyle: "italic" }}>
                        Suggested: {email.triage_action}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--sp-1)", flexShrink: 0 }}>
                    <span style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>{fmtDate(email.created_at)}</span>
                    {/* Override buttons */}
                    <div style={{ display: "flex", gap: 2 }}>
                      {PRIORITY_ORDER.map(p => (
                        <button
                          key={p}
                          onClick={() => override(email.id, p)}
                          title={`Mark as ${p}`}
                          style={{
                            width: 8, height: 8, borderRadius: "50%", border: "none",
                            background: email.triage_priority === p ? PRIORITY_META[p].color : "var(--color-surface-raised)",
                            cursor: "pointer", padding: 0,
                          }}
                        />
                      ))}
                    </div>
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
