"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, CheckCircle2, MessageSquare, Brain, Clock, RefreshCw, AlertTriangle, Radio, Search, Mail, Database, Eye, Cpu, Globe, Sparkles, User, ChevronRight, CalendarDays } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_MS = 30_000;

// ── Profile types ─────────────────────────────────────────────────────────────

interface ProfileData {
  full_name: string;
  location: string;
  email: string;
  phone: string;
  current_role: string;
  experience_years: string;
  availability: string;
  work_type: string;
  salary_expectation: string;
  skills: string[];
  sections: { bio: string; work: string; goals: string; preferences: string; context: string; notes: string };
  updated_at: string | null;
}

function calcCompleteness(p: ProfileData): { filled: number; total: number } {
  let filled = 0;
  if (p.full_name?.trim())         filled++;
  if (p.location?.trim())          filled++;
  if (p.email?.trim())             filled++;
  if (p.current_role?.trim())      filled++;
  if (p.experience_years?.trim())  filled++;
  if (p.skills?.length > 0)        filled++;
  if (p.sections?.bio?.trim())     filled++;
  if (p.sections?.goals?.trim())   filled++;
  if (p.sections?.work?.trim())    filled++;
  return { filled, total: 9 };
}

// ── Agent feed types ──────────────────────────────────────────────────────────
interface AgentFeedEntry {
  id: string;
  ts: number;
  source: "live" | "background";
  agent: string;
  event: string;
  detail: string;
}

const AGENT_EMOJI: Record<string, string> = {
  Scout: "🔍", Hermes: "📧", Sage: "🧠", Lens: "📷", Atlas: "📋", Phantom: "👻",
  hermes_monitor: "📧", atlas_scheduled: "📋", scout_monitor: "📡",
  sage_consolidation: "🧠", gmail_reply_monitor: "📨", email_sync: "🔄",
};
const AGENT_COLOR: Record<string, string> = {
  Scout: "#6366f1", Hermes: "#22c55e", Sage: "#f59e0b",
  Lens: "#ec4899", Atlas: "#3b82f6", Phantom: "#a855f7",
};

function fmtAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

interface CalendarEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
}

interface OnboardingStep {
  id: string;
  label: string;
  done: boolean;
  panel: string;
  description: string;
}

interface OnboardingStatus {
  complete: boolean;
  done: number;
  total: number;
  steps: OnboardingStep[];
}

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
  const [agentFeed, setAgentFeed] = useState<AgentFeedEntry[]>([]);
  const [brief, setBrief]     = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [prodScore, setProdScore] = useState<{ score: number; breakdown: Record<string, { score: number; detail: string }>; trend: string } | null>(null);
  const [calEvents, setCalEvents]   = useState<CalendarEvent[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try { return localStorage.getItem("sj_onboarding_done") === "1"; } catch { return false; }
  });
  const feedRef = useRef<HTMLDivElement>(null);

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

  const loadBrief = useCallback(async () => {
    setBriefLoading(true);
    try {
      const res = await fetch(`${API}/api/dashboard/brief`);
      if (!res.ok) return;
      const data = await res.json();
      setBrief(data.brief);
    } catch { /* silent */ } finally {
      setBriefLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/profile`);
      if (!res.ok) return;
      const data = await res.json();
      setProfile(data);
    } catch { /* silent */ }
  }, []);

  const loadProdScore = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats/productivity`);
      if (!res.ok) return;
      setProdScore(await res.json());
    } catch { /* silent */ }
  }, []);

  const loadCalEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/calendar/today`);
      if (!res.ok) return;
      const data = await res.json();
      setCalEvents(data.events || []);
    } catch { /* silent — calendar may not be connected */ }
  }, []);

  const loadOnboarding = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/onboarding/status`);
      if (!res.ok) return;
      const data = await res.json();
      setOnboarding(data);
      if (data.complete) {
        try { localStorage.setItem("sj_onboarding_done", "1"); } catch { /* ignore */ }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load();
    loadBrief();
    loadProfile();
    loadProdScore();
    loadOnboarding();
    loadCalEvents();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load, loadBrief, loadProfile, loadProdScore, loadOnboarding, loadCalEvents]);

  // Listen for live agent events from chat
  useEffect(() => {
    function onAgentEvent(e: Event) {
      const { type, payload } = (e as CustomEvent).detail as {
        type: string; payload: Record<string, unknown>;
      };
      const agentName = (payload.name || payload.agent || "") as string;
      if (!agentName) return;

      let event = "";
      let detail = "";
      if (type === "AGENT_START") {
        event = "started";
        detail = (payload.task as string || "").slice(0, 60);
      } else if (type === "AGENT_DONE") {
        event = "done";
        detail = `${payload.duration_ms}ms · ${payload.tokens_total || 0} tokens`;
      } else if (type === "AGENT_TOOL") {
        event = payload.tool as string;
        detail = (payload.query as string || "").slice(0, 50);
      } else {
        return;
      }

      const entry: AgentFeedEntry = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        source: "live",
        agent: agentName,
        event,
        detail,
      };
      setAgentFeed(prev => [entry, ...prev].slice(0, 30));
    }

    window.addEventListener("sj:agent", onAgentEvent);
    return () => window.removeEventListener("sj:agent", onAgentEvent);
  }, []);

  // Poll recent background worker notifications for the feed
  useEffect(() => {
    async function loadBackground() {
      try {
        const res = await fetch(`${API}/api/notifications/?limit=8`);
        if (!res.ok) return;
        const data = await res.json();
        const entries: AgentFeedEntry[] = (data.notifications || [])
          .filter((n: Record<string, unknown>) => n.type !== "error")
          .map((n: Record<string, unknown>) => {
            const title = (n.title as string) || "";
            // Infer agent from title
            let agent = "system";
            if (title.includes("Hermes") || title.includes("inbox") || title.includes("email") || title.includes("Interview") || title.includes("Recruiter") || title.includes("Rejection") || title.includes("Response")) agent = "Hermes";
            else if (title.includes("Atlas") || title.includes("digest") || title.includes("report") || title.includes("application")) agent = "Atlas";
            else if (title.includes("Scout")) agent = "Scout";
            else if (title.includes("Memory") || title.includes("Sage")) agent = "Sage";
            return {
              id: String(n.id),
              ts: new Date(n.created_at as string).getTime(),
              source: "background" as const,
              agent,
              event: "completed",
              detail: title.slice(0, 60),
            };
          });
        setAgentFeed(prev => {
          const liveIds = new Set(prev.filter(e => e.source === "live").map(e => e.id));
          const bgEntries = entries.filter(e => !liveIds.has(e.id));
          return [...prev.filter(e => e.source === "live"), ...bgEntries]
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 30);
        });
      } catch { /* silent */ }
    }
    loadBackground();
    const id = setInterval(loadBackground, 60_000);
    return () => clearInterval(id);
  }, []);

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

        {/* ── Onboarding Card ──────────────────────────────────────────────── */}
        {onboarding && !onboarding.complete && !onboardingDismissed && (
          <div className="sj-card" style={{
            borderLeft: "3px solid var(--color-accent)",
            background: "color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-raised))",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
              <span style={{ fontSize: 16 }}>🚀</span>
              <span className="sj-label" style={{ flex: 1 }}>Get Started</span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {onboarding.done}/{onboarding.total}
              </span>
              <button
                onClick={() => {
                  setOnboardingDismissed(true);
                  try { localStorage.setItem("sj_onboarding_done", "1"); } catch { /* ignore */ }
                }}
                title="Dismiss"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: 14, padding: 0 }}
              >
                ×
              </button>
            </div>
            {/* Progress bar */}
            <div style={{ height: 3, borderRadius: "var(--r-full)", background: "var(--color-surface-raised)", overflow: "hidden", marginBottom: "var(--sp-3)" }}>
              <div style={{
                height: "100%", borderRadius: "var(--r-full)", background: "var(--color-accent)",
                width: `${(onboarding.done / onboarding.total) * 100}%`, transition: "width 0.3s",
              }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {onboarding.steps.map(step => (
                <button
                  key={step.id}
                  onClick={() => { window.location.hash = step.panel; }}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--sp-2)",
                    padding: "var(--sp-2) var(--sp-2)", borderRadius: "var(--r-sm)",
                    background: "none", border: "none", cursor: step.done ? "default" : "pointer",
                    textAlign: "left", width: "100%", opacity: step.done ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!step.done) (e.currentTarget as HTMLElement).style.background = "var(--color-surface-raised)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: "var(--r-full)", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: step.done ? "#22c55e22" : "var(--color-surface-raised)",
                    border: `1px solid ${step.done ? "#22c55e" : "var(--color-border)"}`,
                    color: step.done ? "#22c55e" : "var(--color-text-muted)",
                    fontSize: 10,
                  }}>
                    {step.done ? "✓" : "·"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: step.done ? 400 : 500, color: step.done ? "var(--color-text-muted)" : "var(--color-text)" }}>
                      {step.label}
                    </div>
                    {!step.done && (
                      <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{step.description}</div>
                    )}
                  </div>
                  {!step.done && <ChevronRight size={11} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <p className="sj-micro">Loading dashboard...</p>
        ) : !s ? (
          <div className="sj-card" style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <AlertTriangle size={13} style={{ color: "#e25c5c" }} />
            <span className="sj-micro">Could not reach backend. Is it running?</span>
          </div>
        ) : (
          <>
            {/* AI Brief */}
            <div className="sj-card" style={{ background: "color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-raised))", borderColor: "color-mix(in srgb, var(--color-accent) 25%, var(--color-border))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                <Sparkles size={11} style={{ color: "var(--color-accent)" }} />
                <span className="sj-label">Jazper's Brief</span>
                <button
                  onClick={loadBrief}
                  disabled={briefLoading}
                  title="Refresh brief"
                  style={{ background: "none", border: "none", cursor: briefLoading ? "not-allowed" : "pointer", padding: 0, marginLeft: "auto", color: "var(--color-icon)", display: "flex", alignItems: "center", opacity: briefLoading ? 0.4 : 1 }}
                >
                  <RefreshCw size={10} className={briefLoading ? "sj-spin" : undefined} />
                </button>
              </div>
              {briefLoading && !brief ? (
                <p className="sj-micro" style={{ opacity: 0.5 }}>Generating brief…</p>
              ) : brief ? (
                <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0, color: "var(--color-text)" }}>{brief}</p>
              ) : (
                <p className="sj-micro" style={{ opacity: 0.5 }}>Could not load brief.</p>
              )}
            </div>

            {/* Profile Completeness */}
            {profile && (() => {
              const { filled, total } = calcCompleteness(profile);
              const pct = Math.round((filled / total) * 100);
              return (
                <div className="sj-card">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                    <User size={11} style={{ color: "var(--color-icon)" }} />
                    <span className="sj-label">Your Profile</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, marginLeft: "auto",
                      background: pct === 100 ? "#22c55e22" : "var(--color-surface-raised)",
                      color: pct === 100 ? "#22c55e" : "var(--color-text-muted)",
                      border: `1px solid ${pct === 100 ? "#22c55e44" : "var(--color-border)"}`,
                      borderRadius: "var(--r-full)", padding: "1px 7px",
                    }}>
                      {pct}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, borderRadius: "var(--r-full)", background: "var(--color-surface-raised)", overflow: "hidden", marginBottom: "var(--sp-1)" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "var(--color-accent)", borderRadius: "var(--r-full)", transition: "width 0.3s" }} />
                  </div>
                  <span className="sj-micro">{filled}/{total} fields complete</span>
                  {profile.full_name ? (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-1)" }}>
                      Hi, {profile.full_name}
                    </div>
                  ) : pct < 100 ? (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic", marginTop: "var(--sp-1)" }}>
                      Fill the questionnaire or click Load in Resume Manager
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {/* Productivity Score */}
            {prodScore && (
              <div className="sj-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    <Sparkles size={11} style={{ color: "var(--color-accent)" }} />
                    <span className="sj-label">Productivity Score</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: prodScore.score >= 70 ? "#22c55e" : prodScore.score >= 40 ? "#f59e0b" : "#ef4444" }}>
                      {prodScore.score}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>/100</span>
                    <span style={{ fontSize: 12 }}>
                      {prodScore.trend === "up" ? "↑" : prodScore.trend === "down" ? "↓" : "→"}
                    </span>
                  </div>
                </div>
                <div style={{ height: 4, borderRadius: "var(--r-full)", background: "var(--color-surface-raised)", overflow: "hidden", marginBottom: "var(--sp-2)" }}>
                  <div style={{ height: "100%", width: `${prodScore.score}%`, borderRadius: "var(--r-full)", transition: "width 0.4s", background: prodScore.score >= 70 ? "#22c55e" : prodScore.score >= 40 ? "#f59e0b" : "#ef4444" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-1)" }}>
                  {Object.entries(prodScore.breakdown).map(([k, v]) => (
                    <div key={k} style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                      <span style={{ fontWeight: 600, color: "var(--color-text)", textTransform: "capitalize" }}>{k}</span>{" "}
                      <span style={{ color: v.score >= 70 ? "#22c55e" : v.score >= 40 ? "#f59e0b" : "#ef4444" }}>{v.score}</span>
                      {" · "}{v.detail}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Today's Calendar */}
            {calEvents.length > 0 && (
              <div className="sj-card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                  <CalendarDays size={11} style={{ color: "var(--color-icon)" }} />
                  <span className="sj-label">Today's Schedule</span>
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginLeft: "auto" }}>
                    {calEvents.length} event{calEvents.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {calEvents.slice(0, 4).map((ev, i) => {
                    const startStr = ev.start?.dateTime || ev.start?.date || "";
                    const timeStr  = startStr
                      ? (() => { try { return new Date(startStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })()
                      : "All day";
                    const title    = ev.summary || "Untitled event";
                    const isInterview = /interview|call|screening/i.test(title);
                    return (
                      <div key={ev.id ?? i} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "4px 0", borderTop: i > 0 ? "1px solid var(--color-border-lo)" : "none" }}>
                        <span style={{ fontSize: 10, color: "var(--color-text-muted)", width: 42, flexShrink: 0, fontFamily: "var(--font-mono)" }}>{timeStr}</span>
                        <span style={{
                          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                          background: isInterview ? "#f59e0b" : "var(--color-accent)",
                        }} />
                        <span style={{ fontSize: 11, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title}
                        </span>
                        {isInterview && (
                          <button
                            onClick={() => window.location.hash = "calendar"}
                            style={{
                              marginLeft: "auto", flexShrink: 0,
                              fontSize: 9, padding: "1px 6px", borderRadius: "var(--r-full)",
                              background: "color-mix(in srgb, #f59e0b 15%, transparent)",
                              border: "1px solid #f59e0b44", color: "#f59e0b", cursor: "pointer",
                            }}
                          >
                            Prep →
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

        {/* ── Live Agent Feed ───────────────────────────────────────────── */}
        <div className="sj-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--sp-2)",
            padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)",
            background: "var(--color-surface-raised)",
          }}>
            <Radio size={10} style={{ color: "var(--color-accent)" }} />
            <span className="sj-label">Agent Activity</span>
            {agentFeed.some(e => e.source === "live") && (
              <span style={{
                display: "flex", alignItems: "center", gap: 3, fontSize: 9,
                color: "var(--color-accent)", marginLeft: "auto",
              }}>
                <span className="sj-dot sj-dot-live" /> Live
              </span>
            )}
          </div>

          <div ref={feedRef} style={{ maxHeight: 200, overflowY: "auto" }}>
            {agentFeed.length === 0 ? (
              <div style={{ padding: "var(--sp-3)", color: "var(--color-text-muted)", fontSize: 11, textAlign: "center" }}>
                No agent activity yet
              </div>
            ) : (
              agentFeed.map(entry => {
                const color = AGENT_COLOR[entry.agent] || "var(--color-text-muted)";
                return (
                  <div key={entry.id} style={{
                    display: "flex", alignItems: "flex-start", gap: "var(--sp-2)",
                    padding: "var(--sp-1) var(--sp-3)",
                    borderBottom: "1px solid var(--color-border-lo)",
                    opacity: entry.source === "background" ? 0.7 : 1,
                  }}>
                    <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
                      {AGENT_EMOJI[entry.agent] || "🤖"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 500, color }}>
                          {entry.agent}
                        </span>
                        <span className="sj-mono" style={{
                          fontSize: 9, color: "var(--color-text-muted)",
                          background: "var(--color-surface-raised)",
                          padding: "0 4px", borderRadius: 2,
                        }}>
                          {entry.event}
                        </span>
                        {entry.source === "background" && (
                          <span style={{ fontSize: 9, color: "var(--color-text-muted)", marginLeft: "auto", flexShrink: 0 }}>
                            bg
                          </span>
                        )}
                      </div>
                      {entry.detail && (
                        <div style={{
                          fontSize: 10, color: "var(--color-text-muted)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {entry.detail}
                        </div>
                      )}
                    </div>
                    <span className="sj-mono" style={{ fontSize: 9, color: "var(--color-text-muted)", flexShrink: 0, marginTop: 2 }}>
                      {fmtAgo(entry.ts)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
