"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radio, AlertCircle, CheckCircle, Clock, Zap, Activity,
  Terminal, Cpu, Brain, RefreshCw, Circle,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type EventType = "log" | "agent" | "error" | "sched" | "notify";

interface LiveEvent {
  _type:   EventType;
  _ts:     string;
  // log
  level?:    string;
  message?:  string;
  extra?:    Record<string, unknown>;
  // agent
  agent?:    string;
  action?:   string;
  file?:     string;
  reason?:   string;
  summary?:  string;
  confidence?: number;
  // error
  error_id?:  string;
  resolved?:  boolean;
  // scheduler
  job_id?:    string;
  status?:    string;
}

interface SystemStatus {
  scheduler?: { id: string; name: string; next_run: string | null; trigger: string }[];
  errors?:    { total: number; unresolved: number; recent: { agent: string; message: string; ts: string; resolved: boolean }[] };
  tickets?:   { by_status: Record<string, number>; recent: { text: string; status: string; ts: string }[] };
  ai?:        { primary_keys: number; rate_limited_keys: number; all_primary_exhausted: boolean; local_fallback_available: boolean };
  job_apply?: { recent_runs: { status: string; applied: number; ts: string }[] };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<EventType, string> = {
  log:    "#94a3b8",
  agent:  "#60a5fa",
  error:  "#f87171",
  sched:  "#34d399",
  notify: "#a78bfa",
};

const LEVEL_COLOR: Record<string, string> = {
  error:    "#f87171",
  critical: "#f43f5e",
  warning:  "#fbbf24",
  warn:     "#fbbf24",
  info:     "#94a3b8",
  debug:    "#475569",
};

const AGENT_COLOR: Record<string, string> = {
  Oracle:    "#f59e0b",
  Forge:     "#3b82f6",
  Darwin:    "#10b981",
  Scout:     "#6366f1",
  Hermes:    "#22c55e",
  Sage:      "#a78bfa",
  Shield:    "#ef4444",
  Scroll:    "#ec4899",
  Atlas:     "#06b6d4",
  Aria:      "#f97316",
  System:    "#94a3b8",
};

function agentColor(name: string) {
  return AGENT_COLOR[name] ?? "#94a3b8";
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtRelative(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Event feed item ───────────────────────────────────────────────────────────

function EventItem({ ev }: { ev: LiveEvent }) {
  const isError = ev._type === "error" || ev.level === "error" || ev.level === "critical";
  const isAgent = ev._type === "agent";
  const isWarn  = ev.level === "warning" || ev.level === "warn";

  let label = "";
  let detail = "";
  let color = TYPE_COLOR[ev._type] ?? "#94a3b8";

  if (ev._type === "log") {
    color  = LEVEL_COLOR[ev.level ?? "info"] ?? "#94a3b8";
    label  = ev.level?.toUpperCase() ?? "LOG";
    detail = ev.message ?? "";
    if (ev.extra && Object.keys(ev.extra).length > 0) {
      const extras = Object.entries(ev.extra)
        .filter(([k]) => !["event","timestamp","_record"].includes(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      if (extras) detail += "  " + extras;
    }
  } else if (ev._type === "agent") {
    color  = agentColor(ev.agent ?? "");
    label  = ev.agent ?? "AGENT";
    detail = [ev.action, ev.file ? `→ ${ev.file.split("/").pop()}` : null, ev.summary ?? ev.reason].filter(Boolean).join(" ");
  } else if (ev._type === "error") {
    color  = "#f87171";
    label  = "ERROR";
    detail = `[${ev.agent}] ${ev.message ?? ""}`;
  } else if (ev._type === "sched") {
    color  = "#34d399";
    label  = "SCHED";
    detail = `${ev.job_id} — ${ev.status}`;
  }

  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      padding: "3px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      background: isError ? "rgba(248,113,113,0.05)" : isAgent ? "rgba(96,165,250,0.03)" : "transparent",
    }}>
      <span style={{ color: "#475569", flexShrink: 0, fontSize: 10, fontFamily: "monospace", minWidth: 62 }}>
        {fmtTime(ev._ts)}
      </span>
      <span style={{
        color, fontWeight: 700, flexShrink: 0, fontSize: 9,
        textTransform: "uppercase", minWidth: 52, letterSpacing: "0.04em",
        paddingTop: 1,
      }}>
        {label.slice(0, 8)}
      </span>
      <span style={{
        color: isError ? "#fca5a5" : isWarn ? "#fde68a" : isAgent ? "#bfdbfe" : "var(--color-text-dim)",
        fontSize: 11, flex: 1, wordBreak: "break-word", lineHeight: 1.5,
        fontFamily: isError || ev._type === "log" ? "monospace" : "inherit",
      }}>
        {detail.slice(0, 200)}
      </span>
    </div>
  );
}

// ── Agent activity column ─────────────────────────────────────────────────────

function AgentActivityColumn({ events }: { events: LiveEvent[] }) {
  const agentEvents = events.filter(e => e._type === "agent" || (e._type === "log" && e.extra?.agent));
  const byAgent: Record<string, LiveEvent[]> = {};
  for (const ev of agentEvents) {
    const name = ev.agent ?? (ev.extra?.agent as string) ?? "System";
    if (!byAgent[name]) byAgent[name] = [];
    byAgent[name].push(ev);
  }

  const agents = Object.entries(byAgent).sort(([, a], [, b]) => {
    const ta = new Date(a[a.length - 1]._ts).getTime();
    const tb = new Date(b[b.length - 1]._ts).getTime();
    return tb - ta;
  });

  if (agents.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8, opacity: 0.3 }}>
        <Brain size={24} />
        <p style={{ fontSize: 12, margin: 0 }}>No agent activity yet</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
      {agents.map(([name, evs]) => {
        const latest = evs[evs.length - 1];
        const color = agentColor(name);
        const recentAction = latest.action ?? latest.level ?? "active";
        const isActive = (Date.now() - new Date(latest._ts).getTime()) < 30000;
        return (
          <div key={name} style={{
            background: "var(--color-surface)",
            border: `1px solid ${isActive ? color + "55" : "var(--color-border)"}`,
            borderLeft: `3px solid ${color}`,
            borderRadius: 6, padding: "8px 10px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Circle size={6} fill={isActive ? color : "#374151"} color={isActive ? color : "#374151"} />
              <span style={{ fontSize: 12, fontWeight: 700, color }}>{name}</span>
              <span style={{ fontSize: 9, color: "#475569", marginLeft: "auto" }}>
                {fmtRelative(latest._ts)}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-dim)", lineHeight: 1.4 }}>
              {recentAction}{latest.file ? ` → ${latest.file.split("/").pop()}` : ""}
              {latest.summary ? ` — ${latest.summary.slice(0, 60)}` : ""}
            </p>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
              {evs.length} event{evs.length !== 1 ? "s" : ""} this session
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── System health column ──────────────────────────────────────────────────────

function SystemHealthColumn({ status, onRefresh }: { status: SystemStatus | null; onRefresh: () => void }) {
  if (!status) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.3, flexDirection: "column", gap: 8 }}>
      <Activity size={24} />
      <p style={{ fontSize: 12, margin: 0 }}>Loading status…</p>
    </div>
  );

  const { errors, tickets, ai, scheduler, job_apply } = status;
  const unresolvedErrors = errors?.unresolved ?? 0;
  const activeTickets = Object.entries(tickets?.by_status ?? {}).filter(([s]) => !["resolved","rejected"].includes(s)).reduce((a, [, v]) => a + v, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1 }}>

      {/* AI Provider */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 12px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", marginBottom: 8 }}>AI PROVIDER</div>
        {ai && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Circle size={7} fill={ai.all_primary_exhausted ? "#f87171" : "#34d399"} color="none" />
              <span style={{ fontSize: 12 }}>
                {ai.all_primary_exhausted ? "All keys rate-limited" : `${ai.primary_keys - ai.rate_limited_keys}/${ai.primary_keys} keys active`}
              </span>
            </div>
            {ai.local_fallback_available && (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Local fallback: available</div>
            )}
            <div style={{ fontSize: 11, color: "#60a5fa", marginTop: 4 }}>Claude API: wired</div>
          </>
        )}
      </div>

      {/* Errors */}
      <div style={{ background: unresolvedErrors > 0 ? "rgba(248,113,113,0.06)" : "var(--color-surface)", border: `1px solid ${unresolvedErrors > 0 ? "rgba(248,113,113,0.3)" : "var(--color-border)"}`, borderRadius: 6, padding: "10px 12px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", marginBottom: 8 }}>ERROR STORE</div>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: unresolvedErrors > 0 ? "#f87171" : "#34d399" }}>
            {unresolvedErrors} unresolved
          </span>
          <span style={{ fontSize: 12, color: "#475569" }}>{errors?.total ?? 0} total</span>
        </div>
        {errors?.recent.slice(0, 3).map((e, i) => (
          <div key={i} style={{ fontSize: 10, color: e.resolved ? "#475569" : "#fca5a5", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {e.resolved ? "✓" : "✗"} [{e.agent}] {e.message.slice(0, 60)}
          </div>
        ))}
      </div>

      {/* IT Tickets */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 12px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", marginBottom: 8 }}>IT TICKETS</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {Object.entries(tickets?.by_status ?? {}).map(([s, n]) => (
            <span key={s} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 700,
              background: s === "resolved" ? "rgba(52,211,153,0.1)" : s === "failed" ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)",
              color: s === "resolved" ? "#34d399" : s === "failed" ? "#f87171" : "#fbbf24",
            }}>
              {n} {s}
            </span>
          ))}
          {Object.keys(tickets?.by_status ?? {}).length === 0 && (
            <span style={{ fontSize: 11, color: "#475569" }}>No tickets yet</span>
          )}
        </div>
        {activeTickets > 0 && (
          <div style={{ fontSize: 11, color: "#fbbf24" }}>{activeTickets} active — Darwin working</div>
        )}
      </div>

      {/* Scheduler */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 12px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", marginBottom: 8 }}>SCHEDULER</div>
        {(scheduler ?? []).slice(0, 5).map((job, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4, gap: 8 }}>
            <span style={{ color: "var(--color-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {job.name.replace("__", "").replace(/_/g, " ")}
            </span>
            <span style={{ color: "#475569", flexShrink: 0, fontSize: 10 }}>
              {job.next_run ? fmtRelative(job.next_run) : "paused"}
            </span>
          </div>
        ))}
        {(scheduler ?? []).length === 0 && (
          <span style={{ fontSize: 11, color: "#475569" }}>No jobs scheduled</span>
        )}
      </div>

      {/* Job Apply */}
      {(job_apply?.recent_runs?.length ?? 0) > 0 && (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", marginBottom: 8 }}>JOB APPLY</div>
          {job_apply!.recent_runs.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: r.status === "completed" ? "#34d399" : r.status === "running" ? "#60a5fa" : "#f87171" }}>
                {r.status} — {r.applied} applied
              </span>
              <span style={{ color: "#475569", fontSize: 10 }}>{r.ts ? fmtRelative(r.ts) : ""}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={onRefresh} style={{ alignSelf: "flex-start", background: "none", border: "1px solid var(--color-border)", borderRadius: 5, padding: "4px 10px", fontSize: 11, color: "var(--color-text-dim)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
        <RefreshCw size={11} /> Refresh
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const MAX_EVENTS = 600;

export function ObservatoryPanel() {
  const [events,    setEvents]    = useState<LiveEvent[]>([]);
  const [status,    setStatus]    = useState<SystemStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [paused,    setPaused]    = useState(false);
  const [filter,    setFilter]    = useState<"all" | "error" | "agent" | "log">("all");
  const bottomRef   = useRef<HTMLDivElement>(null);
  const pausedRef   = useRef(false);
  pausedRef.current = paused;

  // ── SSE unified stream ────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`${API}/api/stream/stream`);
    setConnected(true);

    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const ev: LiveEvent = JSON.parse(e.data);
        setEvents(prev => {
          const next = [...prev, ev];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
      } catch { /* skip */ }
    };

    es.onerror = () => setConnected(false);
    return () => { es.close(); setConnected(false); };
  }, []);

  // ── System status poll ────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/stream/status`);
      if (r.ok) setStatus(await r.json());
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ── Auto-scroll feed ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, paused]);

  const visible = events.filter(ev => {
    if (filter === "error") return ev._type === "error" || ev.level === "error" || ev.level === "critical";
    if (filter === "agent") return ev._type === "agent";
    if (filter === "log")   return ev._type === "log";
    return true;
  });

  // ── Agent events for middle column (last 5 min) ───────────────────────────
  const cutoff = Date.now() - 5 * 60 * 1000;
  const recentEvents = events.filter(e => new Date(e._ts).getTime() > cutoff);

  return (
    <div className="sj-panel" style={{ height: "100%", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", flexShrink: 0 }}>
        <Radio size={15} style={{ color: connected ? "#34d399" : "#f87171" }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Observatory</span>
        <span style={{ fontSize: 10, color: connected ? "#34d399" : "#f87171", fontWeight: 700 }}>
          {connected ? "● LIVE" : "○ OFFLINE"}
        </span>
        <span style={{ fontSize: 11, color: "#475569", marginLeft: 4 }}>
          {events.length} events
        </span>

        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["all","error","agent","log"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
              background: filter === f ? "var(--color-accent)" : "var(--color-surface)",
              color: filter === f ? "#000" : "var(--color-text-dim)",
              border: "1px solid var(--color-border)", fontWeight: filter === f ? 700 : 400,
              textTransform: "uppercase",
            }}>{f}</button>
          ))}
          <button onClick={() => setPaused(p => !p)} style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", marginLeft: 4,
            background: paused ? "rgba(251,191,36,0.15)" : "var(--color-surface)",
            color: paused ? "#fbbf24" : "var(--color-text-dim)",
            border: `1px solid ${paused ? "#fbbf24" : "var(--color-border)"}`,
          }}>
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button onClick={() => setEvents([])} style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: "var(--color-surface)", color: "var(--color-text-dim)",
            border: "1px solid var(--color-border)",
          }}>Clear</button>
        </div>
      </div>

      {/* 3-column body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 240px 220px", overflow: "hidden", gap: 0 }}>

        {/* ── Col 1: Live event feed ─────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--color-border)", overflow: "hidden" }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 5 }}>
              <Terminal size={11} /> LIVE FEED
            </span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px", fontFamily: "monospace" }}>
            {visible.length === 0 && (
              <p style={{ color: "#475569", fontSize: 11, margin: "20px 0", textAlign: "center" }}>
                {connected ? "Waiting for events…" : "Backend offline"}
              </p>
            )}
            {visible.map((ev, i) => <EventItem key={i} ev={ev} />)}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Col 2: Agent activity ──────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--color-border)", overflow: "hidden" }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 5 }}>
              <Cpu size={11} /> AGENTS
            </span>
          </div>
          <div style={{ flex: 1, overflow: "hidden", padding: "8px", display: "flex", flexDirection: "column" }}>
            <AgentActivityColumn events={recentEvents} />
          </div>
        </div>

        {/* ── Col 3: System health ───────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 5 }}>
              <Zap size={11} /> HEALTH
            </span>
          </div>
          <div style={{ flex: 1, overflow: "hidden", padding: "8px", display: "flex", flexDirection: "column" }}>
            <SystemHealthColumn status={status} onRefresh={fetchStatus} />
          </div>
        </div>

      </div>
    </div>
  );
}
