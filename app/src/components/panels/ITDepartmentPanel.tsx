"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, ChevronDown, ChevronRight, Play, CheckCircle, XCircle, Clock, AlertTriangle, Wrench, Plus, Shield, FlaskConical, Terminal, Zap } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type TicketStatus = "diagnosing" | "awaiting_approval" | "applying" | "testing" | "resolved" | "failed" | "rejected" | "needs_human" | "creating" | "speccing" | "partial" | "test_failed";

type Ticket = {
  id:               string;
  ticket_id:        string;
  type:             "repair" | "create";
  status:           TicketStatus;
  trigger_text:     string;
  traceback:        string;
  affected_files:   string[];
  diagnosis:        Record<string, unknown>;
  proposed_changes: Array<{ file_path: string; old_string: string; new_string: string }>;
  new_files:        Array<{ path: string; description: string }>;
  test_results:     { passed?: number; failed?: number; total?: number; output?: string; ok?: boolean };
  user_approved:    boolean;
  applied:          boolean;
  resolution_note:  string;
  created_at:       string;
  resolved_at:      string | null;
};

type AgentError = {
  error_id:      string;
  agent:         string;
  error_message: string;
  traceback_str: string;
  timestamp:     string;
  resolved:      boolean;
};

// ── Status display ─────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  diagnosing:        { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: <Clock size={12} />,         label: "Diagnosing"     },
  awaiting_approval: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: <AlertTriangle size={12} />, label: "Needs Approval" },
  applying:          { color: "#3b82f6", bg: "rgba(59,130,246,0.1)",  icon: <Wrench size={12} />,        label: "Applying Fix"   },
  testing:           { color: "#8b5cf6", bg: "rgba(139,92,246,0.1)",  icon: <Play size={12} />,          label: "Running Tests"  },
  creating:          { color: "#3b82f6", bg: "rgba(59,130,246,0.1)",  icon: <Plus size={12} />,          label: "Creating Files" },
  speccing:          { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: <Clock size={12} />,         label: "Writing Spec"   },
  resolved:          { color: "#22c55e", bg: "rgba(34,197,94,0.1)",   icon: <CheckCircle size={12} />,   label: "Resolved"       },
  failed:            { color: "#ef4444", bg: "rgba(239,68,68,0.1)",   icon: <XCircle size={12} />,       label: "Failed"         },
  rejected:          { color: "#6b7280", bg: "rgba(107,114,128,0.1)", icon: <XCircle size={12} />,       label: "Rejected"       },
  needs_human:       { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: <AlertTriangle size={12} />, label: "Needs Human"    },
  partial:           { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: <AlertTriangle size={12} />, label: "Partial"        },
  test_failed:       { color: "#ef4444", bg: "rgba(239,68,68,0.1)",   icon: <XCircle size={12} />,       label: "Tests Failed"   },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { color: "#94a3b8", bg: "transparent", icon: null, label: status };
  return (
    <span style={{
      display: "flex", alignItems: "center", gap: 4,
      background: m.bg, color: m.color,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
      padding: "3px 8px", borderRadius: 4, textTransform: "uppercase",
      flexShrink: 0,
    }}>
      {m.icon} {m.label}
    </span>
  );
}

// ── Ticket card ───────────────────────────────────────────────────────────────

function QAGateBlock({ gate, label, icon }: { gate: Record<string, unknown>; label: string; icon: React.ReactNode }) {
  if (!gate || Object.keys(gate).length === 0) return null;
  const ok   = gate.safe !== undefined ? (gate.safe as boolean) : (gate.ok as boolean);
  const color = ok ? "#22c55e" : "#ef4444";
  const issues = (gate.issues as Array<{severity: string; description: string}>) ?? [];
  const failures = (gate.failures as Array<{test_id: string; message: string}>) ?? [];
  return (
    <div style={{ borderLeft: `2px solid color-mix(in srgb, ${color} 40%, transparent)`, paddingLeft: 9, marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color, background: `color-mix(in srgb, ${color} 10%, transparent)`, padding: "1px 6px", borderRadius: 3 }}>
          {ok ? "PASSED" : "BLOCKED"}
        </span>
        {gate.passed !== undefined && (
          <span style={{ fontSize: 10, opacity: 0.5 }}>{String(gate.passed)} passed{gate.failed ? `, ${gate.failed} failed` : ""}</span>
        )}
      </div>
      {!!gate.summary && <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>{String(gate.summary)}</p>}
      {issues.length > 0 && issues.slice(0,3).map((iss, i) => (
        <div key={i} style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>
          <span style={{ color: iss.severity === "CRITICAL" ? "#ef4444" : "#f59e0b", fontWeight: 700 }}>[{iss.severity}]</span>{" "}{iss.description}
        </div>
      ))}
      {failures.length > 0 && failures.slice(0,3).map((f, i) => (
        <div key={i} style={{ fontSize: 10, opacity: 0.65, marginTop: 2, color: "#f87171" }}>{f.test_id}: {f.message?.slice(0, 80)}</div>
      ))}
    </div>
  );
}

function TicketCard({ ticket, onNavigate }: { ticket: Ticket; onNavigate?: (id: string) => void }) {
  const [open, setOpen] = useState(ticket.status !== "resolved" && ticket.status !== "rejected");
  const isActive = !["resolved", "failed", "rejected"].includes(ticket.status);

  return (
    <div style={{
      background:   "var(--color-surface)",
      border:       `1px solid var(--color-border)`,
      borderLeft:   `3px solid ${(STATUS_META[ticket.status] ?? {}).color ?? "#94a3b8"}`,
      borderRadius: 8,
      marginBottom: 10,
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", background: "none", border: "none",
          cursor: "pointer", color: "var(--color-text)", textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", opacity: 0.5, flexShrink: 0,
          background: ticket.type === "repair" ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)",
          color: ticket.type === "repair" ? "#ef4444" : "#3b82f6",
          padding: "2px 6px", borderRadius: 3,
        }}>
          {ticket.type}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.trigger_text || "IT Ticket"}
          </div>
          <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2 }}>
            {new Date(ticket.created_at).toLocaleString()} · {ticket.ticket_id.slice(0, 8)}
          </div>
        </div>
        <StatusBadge status={ticket.status} />
      </button>

      {/* Detail */}
      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Diagnosis */}
          {ticket.diagnosis && Object.keys(ticket.diagnosis).length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 5 }}>Oracle Diagnosis</div>
              {(ticket.diagnosis as any).diagnosis && (
                <p style={{ margin: 0, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
                  {String((ticket.diagnosis as any).diagnosis)}
                </p>
              )}
              {(ticket.diagnosis as any).confidence !== undefined && (
                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                  Confidence: {Math.round(Number((ticket.diagnosis as any).confidence) * 100)}%
                </div>
              )}
            </div>
          )}

          {/* Proposed changes */}
          {ticket.proposed_changes?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 5 }}>Proposed Fix</div>
              {ticket.proposed_changes.map((c, i) => (
                <div key={i} style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 5, padding: 10, fontSize: 11 }}>
                  <div style={{ opacity: 0.6, marginBottom: 6 }}>📄 {c.file_path}</div>
                  {c.old_string && (
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 9, opacity: 0.4, marginBottom: 2 }}>REMOVE:</div>
                      <pre style={{ margin: 0, background: "rgba(239,68,68,0.08)", borderRadius: 3, padding: "4px 8px", fontSize: 10, overflowX: "auto", color: "#f87171" }}>
                        {c.old_string.slice(0, 300)}
                      </pre>
                    </div>
                  )}
                  {c.new_string && (
                    <div>
                      <div style={{ fontSize: 9, opacity: 0.4, marginBottom: 2 }}>ADD:</div>
                      <pre style={{ margin: 0, background: "rgba(34,197,94,0.08)", borderRadius: 3, padding: "4px 8px", fontSize: 10, overflowX: "auto", color: "#4ade80" }}>
                        {c.new_string.slice(0, 300)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* New files (create workflow) */}
          {ticket.new_files?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 5 }}>Files to Create</div>
              {ticket.new_files.map((f: any, i: number) => (
                <div key={i} style={{ fontSize: 11, padding: "3px 0", opacity: 0.8 }}>
                  📄 {f.path} {f.description && <span style={{ opacity: 0.5 }}>— {f.description}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Awaiting approval — show link to Approvals panel */}
          {ticket.status === "awaiting_approval" && (
            <div style={{
              background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.25)",
              borderRadius: 6, padding: "8px 11px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <AlertTriangle size={13} style={{ color: "#fb923c", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#fb923c", flex: 1 }}>Darwin is waiting for your approval before applying this fix.</span>
              {onNavigate && (
                <button
                  onClick={() => onNavigate("approvals")}
                  style={{
                    background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)",
                    borderRadius: 5, padding: "4px 10px", fontSize: 10, fontWeight: 700,
                    color: "#fb923c", cursor: "pointer", flexShrink: 0,
                  }}
                >
                  Review →
                </button>
              )}
            </div>
          )}

          {/* Aria QA Gate results */}
          {(() => {
            const d = ticket.diagnosis as Record<string, unknown>;
            const gate1 = d?.gate1 as Record<string, unknown> | undefined;
            const verdict = gate1?.verdict as Record<string, unknown> | undefined;
            const probe   = ticket.test_results as Record<string, unknown>;
            return (
              <>
                {verdict && Object.keys(verdict).length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 6 }}>
                      <Shield size={11} style={{ display: "inline", marginRight: 4 }} />Aria Gate 1 — Verdict
                    </div>
                    <QAGateBlock gate={verdict} label="Static diff review" icon={<Shield size={11} style={{ color: "#22c55e" }} />} />
                  </div>
                )}
                {probe && probe.ok !== undefined && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 6 }}>
                      <FlaskConical size={11} style={{ display: "inline", marginRight: 4 }} />Aria Gate 2 — Probe
                    </div>
                    <QAGateBlock gate={probe} label="Test suite" icon={<FlaskConical size={11} style={{ color: "#8b5cf6" }} />} />
                  </div>
                )}
              </>
            );
          })()}

          {/* Test results (legacy / fallback) */}
          {ticket.test_results && Object.keys(ticket.test_results).length > 0 && (ticket.test_results as Record<string, unknown>).ok === undefined && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 5 }}>Probe Test Results</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#22c55e" }}>✓ {ticket.test_results.passed ?? 0} passed</span>
                {(ticket.test_results.failed ?? 0) > 0 && (
                  <span style={{ fontSize: 12, color: "#ef4444" }}>✗ {ticket.test_results.failed} failed</span>
                )}
              </div>
              {ticket.test_results.output && (
                <pre style={{
                  margin: 0, fontSize: 10, background: "var(--color-bg)",
                  border: "1px solid var(--color-border)", borderRadius: 4,
                  padding: "6px 8px", maxHeight: 150, overflowY: "auto",
                  color: ticket.test_results.ok ? "#4ade80" : "#f87171",
                }}>
                  {ticket.test_results.output.slice(-1500)}
                </pre>
              )}
            </div>
          )}

          {/* Resolution note */}
          {ticket.resolution_note && (
            <div style={{ fontSize: 11, opacity: 0.6, fontStyle: "italic" }}>
              {ticket.resolution_note}
            </div>
          )}

          {/* Traceback (collapsed) */}
          {ticket.traceback && <TracebackBlock text={ticket.traceback} />}
        </div>
      )}
    </div>
  );
}

function TracebackBlock({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <button
        onClick={() => setShow(s => !s)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text)", opacity: 0.4, fontSize: 10, padding: 0 }}
      >
        {show ? "▲ Hide traceback" : "▼ Show traceback"}
      </button>
      {show && (
        <pre style={{
          marginTop: 6, fontSize: 10, background: "var(--color-bg)",
          border: "1px solid var(--color-border)", borderRadius: 4,
          padding: "6px 8px", maxHeight: 200, overflowY: "auto", opacity: 0.7,
        }}>
          {text.slice(0, 3000)}
        </pre>
      )}
    </div>
  );
}

// ── Error row ─────────────────────────────────────────────────────────────────

function ErrorRow({ err, onRepair }: { err: AgentError; onRepair: (id: string) => void }) {
  return (
    <div style={{
      padding: "10px 12px",
      background: err.resolved ? "var(--color-surface)" : "rgba(239,68,68,0.05)",
      border: `1px solid ${err.resolved ? "var(--color-border)" : "rgba(239,68,68,0.2)"}`,
      borderRadius: 6, marginBottom: 6,
      display: "flex", alignItems: "flex-start", gap: 10,
      opacity: err.resolved ? 0.5 : 1,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: err.resolved ? "var(--color-text)" : "#f87171" }}>
          {err.agent} — {err.error_message.slice(0, 120)}
        </div>
        <div style={{ fontSize: 10, opacity: 0.45, marginTop: 3 }}>
          {new Date(err.timestamp).toLocaleString()} · {err.error_id.slice(0, 8)}
        </div>
      </div>
      {!err.resolved && (
        <button
          onClick={() => onRepair(err.error_id)}
          title="Trigger Darwin repair"
          style={{
            background: "var(--color-accent)", border: "none", borderRadius: 5,
            padding: "4px 10px", fontSize: 10, fontWeight: 700,
            color: "#000", cursor: "pointer", flexShrink: 0,
          }}
        >
          Fix
        </button>
      )}
    </div>
  );
}

// ── Create panel ──────────────────────────────────────────────────────────────

function CreateFeatureForm({ onSubmit }: { onSubmit: (desc: string) => void }) {
  const [desc, setDesc] = useState("");
  return (
    <div style={{
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: 8, padding: 14, marginBottom: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, marginBottom: 8 }}>
        Self-Create — Describe a new feature
      </div>
      <textarea
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="e.g. Add a /api/weather endpoint that returns current weather for a given city using wttr.in"
        rows={3}
        style={{
          width: "100%", background: "var(--color-bg)", border: "1px solid var(--color-border)",
          borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "var(--color-text)",
          resize: "vertical", outline: "none", boxSizing: "border-box",
        }}
      />
      <button
        onClick={() => { if (desc.trim()) { onSubmit(desc.trim()); setDesc(""); } }}
        disabled={!desc.trim()}
        style={{
          marginTop: 8, background: "var(--color-accent)", border: "none",
          borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700,
          color: "#000", cursor: desc.trim() ? "pointer" : "not-allowed",
          opacity: desc.trim() ? 1 : 0.4,
        }}
      >
        Generate with Scroll + Darwin
      </button>
    </div>
  );
}

// ── Live log stream ───────────────────────────────────────────────────────────

type LogEntry = { level: string; message: string; timestamp: string; extra?: Record<string, unknown> };

const LOG_COLOR: Record<string, string> = {
  error:    "#f87171",
  critical: "#f43f5e",
  warning:  "#fbbf24",
  warn:     "#fbbf24",
  info:     "#94a3b8",
  debug:    "#475569",
};

function LiveLogs({ onIngestError }: { onIngestError: (entry: LogEntry) => void }) {
  const [logs,    setLogs]    = useState<LogEntry[]>([]);
  const [filter,  setFilter]  = useState<"all" | "error" | "warning" | "info">("all");
  const [paused,  setPaused]  = useState(false);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource(`${API}/api/it/logs/stream`);
    setConnected(true);

    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const entry: LogEntry = JSON.parse(e.data);
        setLogs(prev => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch { /* skip malformed */ }
    };

    es.onerror = () => setConnected(false);
    return () => { es.close(); setConnected(false); };
  }, []);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, paused]);

  const visible = filter === "all"
    ? logs
    : logs.filter(l => {
        if (filter === "error")   return ["error","critical"].includes(l.level);
        if (filter === "warning") return ["warning","warn"].includes(l.level);
        return l.level === "info";
      });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* toolbar */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 0", flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: connected ? "#34d399" : "#f87171" }}>
          {connected ? "● LIVE" : "○ OFFLINE"}
        </span>
        {(["all","error","warning","info"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: filter === f ? "var(--color-accent)" : "var(--color-surface)",
            color: filter === f ? "#000" : "var(--color-text-dim)",
            border: "1px solid var(--color-border)", fontWeight: filter === f ? 700 : 400,
            textTransform: "uppercase",
          }}>{f}</button>
        ))}
        <button onClick={() => setPaused(p => !p)} style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", marginLeft: "auto",
          background: paused ? "rgba(251,191,36,0.15)" : "var(--color-surface)",
          color: paused ? "#fbbf24" : "var(--color-text-dim)",
          border: `1px solid ${paused ? "#fbbf24" : "var(--color-border)"}`,
        }}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button onClick={() => setLogs([])} style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
          background: "var(--color-surface)", color: "var(--color-text-dim)",
          border: "1px solid var(--color-border)",
        }}>Clear</button>
      </div>

      {/* log output */}
      <div style={{
        flex: 1, overflowY: "auto", fontFamily: "monospace", fontSize: 11,
        background: "var(--color-bg)", border: "1px solid var(--color-border)",
        borderRadius: 6, padding: "8px 10px", lineHeight: 1.65,
      }}>
        {visible.length === 0 && (
          <p style={{ color: "var(--color-text-dim)", opacity: 0.4, margin: 0 }}>
            Waiting for log events…
          </p>
        )}
        {visible.map((l, i) => {
          const isError = ["error","critical"].includes(l.level);
          const color   = LOG_COLOR[l.level] ?? "#94a3b8";
          const ts      = new Date(l.timestamp).toLocaleTimeString();
          return (
            <div key={i} style={{
              display: "flex", gap: 8, alignItems: "flex-start",
              borderBottom: "1px solid var(--color-border)", padding: "2px 0",
              background: isError ? "rgba(239,68,68,0.04)" : "transparent",
            }}>
              <span style={{ color: "#475569", flexShrink: 0, fontSize: 10 }}>{ts}</span>
              <span style={{ color, fontWeight: isError ? 700 : 400, flexShrink: 0, fontSize: 10, textTransform: "uppercase", minWidth: 46 }}>
                {l.level}
              </span>
              <span style={{ color: isError ? "#fca5a5" : "var(--color-text-dim)", flex: 1, wordBreak: "break-word" }}>
                {l.message}
                {l.extra && Object.keys(l.extra).length > 0 && (
                  <span style={{ opacity: 0.45 }}> {JSON.stringify(l.extra).slice(0, 120)}</span>
                )}
              </span>
              {isError && (
                <button
                  onClick={() => onIngestError(l)}
                  title="Send to Darwin for auto-repair"
                  style={{
                    flexShrink: 0, background: "#7c3aed22", border: "1px solid #7c3aed55",
                    borderRadius: 4, padding: "1px 6px", fontSize: 9, fontWeight: 700,
                    color: "#a78bfa", cursor: "pointer",
                  }}
                >
                  <Zap size={9} style={{ display: "inline", marginRight: 2 }} />Fix
                </button>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ITDepartmentPanel({ onNavigate }: { onNavigate?: (id: string) => void } = {}) {
  const [tab,     setTab]     = useState<"logs" | "tickets" | "errors">("logs");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [errors,  setErrors]  = useState<AgentError[]>([]);
  const [consec,  setConsec]  = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [msg,     setMsg]     = useState("");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/it/tickets`);
      const d = await r.json();
      setTickets(d.tickets ?? []);
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  const loadErrors = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/it/errors`);
      const d = await r.json();
      setErrors(d.errors ?? []);
      setConsec(d.consecutive ?? {});
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { tab === "tickets" ? loadTickets() : loadErrors(); }, [tab, loadTickets, loadErrors]);

  async function triggerRepair(errorId: string) {
    setMsg("Darwin triggered — check Tickets tab for progress.");
    await fetch(`${API}/api/it/repair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error_id: errorId }),
    });
    setTimeout(() => setMsg(""), 4000);
  }

  async function triggerCreate(description: string) {
    setMsg("Scroll + Darwin started — check Tickets tab for progress.");
    await fetch(`${API}/api/it/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    setTimeout(() => setMsg(""), 5000);
  }

  const activeTickets   = tickets.filter(t => !["resolved","rejected"].includes(t.status));
  const resolvedTickets = tickets.filter(t =>  ["resolved","rejected"].includes(t.status));

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 className="sj-heading" style={{ margin: 0, flex: 1 }}>IT Department</h2>
        <div style={{ display: "flex", gap: 4 }}>
          {(["logs", "tickets", "errors"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background:  tab === t ? "var(--color-accent)" : "var(--color-surface)",
              color:       tab === t ? "#000" : "var(--color-text)",
              border:      "1px solid var(--color-border)", borderRadius: 5,
              padding:     "4px 12px", fontSize: 11, cursor: "pointer",
              fontWeight:  tab === t ? 700 : 400,
              textTransform: "capitalize",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {t === "logs" && <Terminal size={11} />}
              {t}
              {t === "errors" && Object.values(consec).some(v => v >= 3) && (
                <span style={{ background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 9, padding: "1px 5px" }}>!</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => tab === "tickets" ? loadTickets() : loadErrors()}
          style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 5, padding: "4px 8px", cursor: "pointer", color: "var(--color-text)" }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {msg && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#4ade80", marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* ── Logs tab ─────────────────────────────────────────────────── */}
        {tab === "logs" && (
          <LiveLogs onIngestError={async (entry) => {
            setMsg("Sending to Darwin for repair…");
            try {
              await fetch(`${API}/api/it/errors/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agent: entry.extra?.agent as string ?? "System",
                  error: entry.message,
                  traceback: entry.extra?.traceback as string ?? "",
                }),
              });
              setMsg("Darwin dispatched — check Tickets tab.");
            } catch { setMsg("Could not reach backend."); }
            setTimeout(() => setMsg(""), 4000);
          }} />
        )}

        {/* ── Tickets tab ──────────────────────────────────────────────── */}
        {tab === "tickets" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <CreateFeatureForm onSubmit={triggerCreate} />

            {loading && <p style={{ opacity: 0.4, fontSize: 12 }}>Loading tickets…</p>}

            {!loading && tickets.length === 0 && (
              <div style={{ textAlign: "center", marginTop: 40, opacity: 0.35 }}>
                <p style={{ fontSize: 13, margin: 0 }}>No IT tickets yet.</p>
                <p style={{ fontSize: 11, marginTop: 6 }}>Sentry monitors for errors every 30s and wakes Darwin automatically.</p>
              </div>
            )}

            {activeTickets.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Active</div>
                {activeTickets.map(t => <TicketCard key={t.id} ticket={t} onNavigate={onNavigate} />)}
              </>
            )}

            {resolvedTickets.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, marginTop: activeTickets.length > 0 ? 16 : 0 }}>History</div>
                {resolvedTickets.map(t => <TicketCard key={t.id} ticket={t} onNavigate={onNavigate} />)}
              </>
            )}
          </div>
        )}

        {/* ── Errors tab ───────────────────────────────────────────────── */}
        {tab === "errors" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* Consecutive failure counters */}
            {Object.entries(consec).some(([, v]) => v > 0) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {Object.entries(consec).map(([agent, count]) => (
                  count > 0 && (
                    <div key={agent} style={{
                      padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600,
                      background: count >= 3 ? "rgba(239,68,68,0.12)" : "var(--color-surface)",
                      border: `1px solid ${count >= 3 ? "#ef4444" : "var(--color-border)"}`,
                      color: count >= 3 ? "#f87171" : "var(--color-text)",
                    }}>
                      {agent}: {count} consecutive {count >= 3 ? "⚠️" : ""}
                    </div>
                  )
                ))}
              </div>
            )}

            {loading && <p style={{ opacity: 0.4, fontSize: 12 }}>Loading errors…</p>}

            {!loading && errors.length === 0 && (
              <div style={{ textAlign: "center", marginTop: 40, opacity: 0.35 }}>
                <p style={{ fontSize: 13, margin: 0 }}>No errors recorded.</p>
              </div>
            )}

            {errors.map(e => (
              <ErrorRow key={e.error_id} err={e} onRepair={triggerRepair} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
