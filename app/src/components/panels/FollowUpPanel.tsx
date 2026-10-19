"use client";

import { useState, useEffect, useCallback } from "react";
import { Send, RefreshCw, Loader2, Clock, CheckCircle2, Mail } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type FollowUpType = "first" | "second" | "final";

interface DueFollowUp {
  id: string;
  company: string;
  job_title: string;
  applied_at: string;
  days_since: number;
  suggested_followup_type: FollowUpType;
  last_followup_at: string | null;
}

interface DraftResult {
  subject: string;
  body: string;
  company: string;
  job_title: string;
}

interface HistoryItem {
  id: string;
  company: string;
  job_title: string;
  last_followup_at: string;
}

const FOLLOWUP_META: Record<FollowUpType, { label: string; color: string; desc: string }> = {
  first:  { label: "1st Follow-up",  color: "#3b82f6", desc: "7 days after applying" },
  second: { label: "2nd Follow-up",  color: "#f59e0b", desc: "14 days after applying" },
  final:  { label: "Final Check-in", color: "#8b5cf6", desc: "21 days after applying" },
};

function fmtDate(ts: string) {
  try { return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return ""; }
}

export function FollowUpPanel() {
  const toast = useToast();

  const [tab, setTab]             = useState<"due" | "history">("due");
  const [due, setDue]             = useState<DueFollowUp[]>([]);
  const [history, setHistory]     = useState<HistoryItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [drafting, setDrafting]   = useState<string | null>(null);
  const [draft, setDraft]         = useState<DraftResult | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dueRes, histRes] = await Promise.all([
        fetch(`${API}/api/followup/due`),
        fetch(`${API}/api/followup/history`),
      ]);
      if (dueRes.ok)  setDue((await dueRes.json()).applications || []);
      if (histRes.ok) setHistory((await histRes.json()).applications || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateDraft(app: DueFollowUp) {
    setDrafting(app.id);
    setDraft(null);
    try {
      const res = await fetch(`${API}/api/followup/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: app.id, followup_type: app.suggested_followup_type }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft(await res.json());
    } catch (e) {
      toast(`Draft failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setDrafting(null); }
  }

  async function markSent(app: DueFollowUp) {
    setMarkingId(app.id);
    try {
      await fetch(`${API}/api/followup/mark-sent`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: app.id }),
      });
      toast(`Follow-up marked sent for ${app.company}`, "success");
      setDraft(null);
      setDue(prev => prev.filter(d => d.id !== app.id));
      load();
    } catch { toast("Failed to mark sent", "error"); } finally { setMarkingId(null); }
  }

  function sendViaCompose(d: DraftResult) {
    localStorage.setItem("sj_compose_prefill", JSON.stringify({
      subject: d.subject, body: d.body,
    }));
    window.location.hash = "compose";
    toast("Draft loaded in composer", "info");
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Send size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Follow-Up Automator</span>
        {due.length > 0 && (
          <span style={{ marginLeft: "var(--sp-2)", fontSize: 10, background: "#3b82f618", border: "1px solid #3b82f644", color: "#3b82f6", padding: "1px 7px", borderRadius: "var(--r-full)", fontWeight: 600 }}>
            {due.length} due
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          {(["due", "history"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 11,
              background: tab === t ? "var(--color-surface-raised)" : "none",
              color: tab === t ? "var(--color-text)" : "var(--color-text-muted)",
            }}>
              {t === "due" ? "Due Now" : "History"}
            </button>
          ))}
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
        </div>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {tab === "due" && (
          <>
            {loading ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
            ) : due.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>✅</div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>All caught up!</p>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: "var(--sp-2)" }}>
                  No follow-ups due today. Check back at the 7, 14, and 21-day marks after applying.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {due.map(app => {
                  const meta = FOLLOWUP_META[app.suggested_followup_type];
                  const isDrafting = drafting === app.id;
                  const isMarking  = markingId === app.id;
                  const showDraft  = draft && drafting === null && due.find(d => d.id === app.id);

                  return (
                    <div key={app.id} style={{ borderBottom: "1px solid var(--color-border-lo)" }}>
                      <div style={{ padding: "var(--sp-3)", display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                        <Clock size={14} style={{ color: meta.color, flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{app.company}</span>
                            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>· {app.job_title}</span>
                            <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: "var(--r-full)", background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color, fontWeight: 700 }}>
                              {meta.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", marginTop: "var(--sp-1)" }}>
                            Applied {fmtDate(app.applied_at)} · {app.days_since} days ago · {meta.desc}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "var(--sp-1)", flexShrink: 0 }}>
                          <button
                            onClick={() => generateDraft(app)}
                            disabled={isDrafting}
                            style={{ padding: "4px 10px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: isDrafting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 3 }}
                          >
                            {isDrafting ? <Loader2 size={10} className="sj-spin" /> : <Mail size={10} />}
                            {isDrafting ? "Drafting…" : "Draft"}
                          </button>
                          <button
                            onClick={() => markSent(app)}
                            disabled={isMarking}
                            style={{ padding: "4px 8px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", color: "var(--color-text-muted)", fontSize: 11, cursor: isMarking ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 3 }}
                          >
                            {isMarking ? <Loader2 size={10} className="sj-spin" /> : <CheckCircle2 size={10} />}
                          </button>
                        </div>
                      </div>

                      {/* Draft output (only show for this specific app) */}
                      {draft && !isDrafting && app.id === due.find(d => d.company === draft.company && d.job_title === draft.job_title)?.id && (
                        <div style={{ margin: "0 var(--sp-3) var(--sp-3) 26px", padding: "var(--sp-3)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", border: "var(--border)" }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text)", margin: "0 0 4px" }}>Subject: {draft.subject}</p>
                          <pre style={{ fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.6, margin: "0 0 var(--sp-2)", fontFamily: "inherit" }}>{draft.body}</pre>
                          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                            <button onClick={() => sendViaCompose(draft)} style={{ padding: "5px 12px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                              <Send size={10} /> Edit & Send
                            </button>
                            <button onClick={() => markSent(app)} style={{ padding: "5px 12px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 11, cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                              <CheckCircle2 size={10} /> Mark Sent
                            </button>
                            <button onClick={() => setDraft(null)} style={{ padding: "5px 10px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 11, cursor: "pointer", color: "var(--color-text-muted)" }}>
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ height: "var(--sp-4)" }} />
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "var(--sp-2) var(--sp-4)", borderBottom: "var(--border)" }}>
              <span className="sj-label">Sent Follow-Ups</span>
            </div>
            {loading ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
            ) : history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No follow-ups sent yet.</p>
              </div>
            ) : history.map(h => (
              <div key={h.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <CheckCircle2 size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>{h.company}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}> · {h.job_title}</span>
                </div>
                <span style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>{fmtDate(h.last_followup_at)}</span>
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
