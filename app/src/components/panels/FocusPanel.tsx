"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Timer, Play, Square, SkipForward, RefreshCw, Zap, Coffee, Infinity } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type SessionType = "pomodoro" | "deep_work" | "custom";

const SESSION_PRESETS: { type: SessionType; label: string; minutes: number; icon: React.ReactNode; color: string }[] = [
  { type: "pomodoro",  label: "Pomodoro",   minutes: 25, icon: <Coffee size={14} />,    color: "#ef4444" },
  { type: "deep_work", label: "Deep Work",  minutes: 50, icon: <Zap size={14} />,       color: "#8b5cf6" },
  { type: "custom",    label: "Custom",     minutes: 45, icon: <Infinity size={14} />,  color: "#3b82f6" },
];

interface FocusStat {
  week_total_minutes: number;
  week_sessions: number;
  week_completed: number;
  today_minutes: number;
  longest_streak_days: number;
  current_streak_days: number;
  most_productive_hour: number | null;
}

interface FocusSession {
  id: string;
  task_title: string;
  duration_minutes: number;
  actual_minutes: number;
  type: string;
  status: string;
  started_at: string;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtHour(h: number | null): string {
  if (h === null) return "—";
  const ampm = h >= 12 ? "PM" : "AM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp}:00 ${ampm}`;
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface CircleTimerProps {
  progress: number; // 0..1
  seconds: number;
  color: string;
  size?: number;
}

function CircleTimer({ progress, seconds, color, size = 200 }: CircleTimerProps) {
  const R = (size - 16) / 2;
  const circumference = 2 * Math.PI * R;
  const dash = circumference * (1 - progress);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--color-surface-raised)" strokeWidth={8} />
      <circle
        cx={size / 2} cy={size / 2} r={R} fill="none" stroke={color} strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dash}
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
      <text
        x={size / 2} y={size / 2 + 8}
        textAnchor="middle"
        style={{ transform: "rotate(90deg)", transformOrigin: `${size / 2}px ${size / 2}px`, fill: "var(--color-text)", fontSize: 32, fontWeight: 700, fontFamily: "var(--font-mono)" }}
      >
        {fmtTime(seconds)}
      </text>
    </svg>
  );
}

export function FocusPanel() {
  const toast = useToast();

  const [tab, setTab] = useState<"timer" | "history">("timer");

  // Timer state
  const [selectedType, setSelectedType] = useState<SessionType>("pomodoro");
  const [customMinutes, setCustomMinutes] = useState(45);
  const [taskTitle, setTaskTitle]   = useState("");
  const [running, setRunning]       = useState(false);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [totalSec, setTotalSec]     = useState(25 * 60);
  const [remainSec, setRemainSec]   = useState(25 * 60);
  const [elapsed, setElapsed]       = useState(0);
  const [finishing, setFinishing]   = useState(false);

  // Stats + sessions
  const [stats, setStats]           = useState<FocusStat | null>(null);
  const [sessions, setSessions]     = useState<FocusSession[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const preset = SESSION_PRESETS.find(p => p.type === selectedType)!;
  const effectiveMinutes = selectedType === "custom" ? customMinutes : preset.minutes;

  // Load stats + history
  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const [sRes, hRes] = await Promise.all([
        fetch(`${API}/api/focus/stats`),
        fetch(`${API}/api/focus/sessions?limit=20&status=all`),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (hRes.ok) setSessions((await hRes.json()).sessions || []);
    } catch { /* silent */ } finally { setHistLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Reset timer when type/minutes changes (only if not running)
  useEffect(() => {
    if (!running) {
      setTotalSec(effectiveMinutes * 60);
      setRemainSec(effectiveMinutes * 60);
      setElapsed(0);
    }
  }, [effectiveMinutes, running]);

  // Tick
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemainSec(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            setRunning(false);
            handleComplete();
            return 0;
          }
          return prev - 1;
        });
        setElapsed(e => e + 1);
      }, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  async function startSession() {
    if (!taskTitle.trim()) { toast("Enter a task title first", "warning"); return; }
    try {
      const res = await fetch(`${API}/api/focus/sessions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_title: taskTitle, duration_minutes: effectiveMinutes, type: selectedType }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionId(data.id);
      setTotalSec(effectiveMinutes * 60);
      setRemainSec(effectiveMinutes * 60);
      setElapsed(0);
      setRunning(true);
      toast(`${selectedType === "pomodoro" ? "🍅" : selectedType === "deep_work" ? "⚡" : "⏱️"} Focus started — ${effectiveMinutes}min on: ${taskTitle}`, "success");
    } catch (e) {
      toast(`Failed to start: ${e instanceof Error ? e.message : "error"}`, "error");
    }
  }

  async function handleComplete() {
    if (!sessionId || finishing) return;
    setFinishing(true);
    try {
      await fetch(`${API}/api/focus/sessions/${sessionId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", actual_minutes: Math.round(elapsed / 60) }),
      });
      toast(`🎯 Focus complete! ${fmtDuration(Math.round(elapsed / 60))} on: ${taskTitle}`, "success");
      loadHistory();
      setSessionId(null);
      setElapsed(0);
    } catch { /* silent */ } finally { setFinishing(false); }
  }

  async function stopSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    if (sessionId) {
      try {
        await fetch(`${API}/api/focus/sessions/${sessionId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled", actual_minutes: Math.round(elapsed / 60) }),
        });
        loadHistory();
      } catch { /* silent */ }
      setSessionId(null);
    }
    setTotalSec(effectiveMinutes * 60);
    setRemainSec(effectiveMinutes * 60);
    setElapsed(0);
    toast("Focus session stopped", "info");
  }

  async function skipSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    await handleComplete();
    setTotalSec(effectiveMinutes * 60);
    setRemainSec(effectiveMinutes * 60);
  }

  const progress = totalSec > 0 ? 1 - remainSec / totalSec : 0;
  const activeColor = SESSION_PRESETS.find(p => p.type === selectedType)?.color || "#3b82f6";

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Timer size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Focus & Deep Work</span>
        {running && (
          <span style={{ marginLeft: "var(--sp-2)", fontSize: 10, fontFamily: "var(--font-mono)", color: activeColor, fontWeight: 600 }}>
            ● LIVE
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {(["timer", "history"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 11,
              background: tab === t ? "var(--color-surface-raised)" : "none",
              color: tab === t ? "var(--color-text)" : "var(--color-text-muted)",
            }}>
              {t === "timer" ? "Timer" : "History"}
            </button>
          ))}
        </div>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>

        {/* ── TIMER TAB ─────────────────────────────────────────────── */}
        {tab === "timer" && (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-4)" }}>

            {/* Session type selector */}
            <div style={{ display: "flex", gap: "var(--sp-2)", width: "100%", maxWidth: 400 }}>
              {SESSION_PRESETS.map(p => (
                <button
                  key={p.type}
                  disabled={running}
                  onClick={() => setSelectedType(p.type)}
                  style={{
                    flex: 1, padding: "var(--sp-2)", borderRadius: "var(--r-sm)",
                    border: selectedType === p.type ? `1px solid ${p.color}88` : "var(--border)",
                    background: selectedType === p.type ? `${p.color}18` : "var(--color-surface-raised)",
                    color: selectedType === p.type ? p.color : "var(--color-text-muted)",
                    cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.5 : 1,
                    fontSize: 11, fontWeight: selectedType === p.type ? 600 : 400,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  }}
                >
                  <span style={{ color: selectedType === p.type ? p.color : "var(--color-icon)" }}>{p.icon}</span>
                  <span>{p.label}</span>
                  <span style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>{p.minutes}m</span>
                </button>
              ))}
            </div>

            {/* Custom minutes input */}
            {selectedType === "custom" && !running && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", maxWidth: 400, width: "100%" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-muted)", flexShrink: 0 }}>Duration:</span>
                <input
                  type="number" min={1} max={240}
                  value={customMinutes}
                  onChange={e => setCustomMinutes(Math.max(1, Math.min(240, Number(e.target.value))))}
                  className="sj-input"
                  style={{ width: 80, textAlign: "center", fontFamily: "var(--font-mono)" }}
                />
                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>minutes</span>
              </div>
            )}

            {/* Task title */}
            {!running && (
              <input
                className="sj-input"
                placeholder="What are you working on?"
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                style={{ fontSize: 13, maxWidth: 400, width: "100%" }}
                onKeyDown={e => { if (e.key === "Enter" && taskTitle.trim()) startSession(); }}
              />
            )}

            {/* Big timer circle */}
            <div style={{ position: "relative", marginTop: running ? "var(--sp-2)" : 0 }}>
              <CircleTimer progress={progress} seconds={remainSec} color={activeColor} size={220} />
              {running && (
                <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>
                  {taskTitle}
                </div>
              )}
            </div>

            {/* Controls */}
            <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
              {!running ? (
                <button
                  onClick={startSession}
                  disabled={!taskTitle.trim()}
                  style={{
                    padding: "10px 32px", borderRadius: "var(--r-sm)", border: "none",
                    background: !taskTitle.trim() ? "var(--color-surface-raised)" : activeColor,
                    color: "#fff", fontSize: 13, fontWeight: 700,
                    cursor: !taskTitle.trim() ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: "var(--sp-2)",
                    opacity: !taskTitle.trim() ? 0.5 : 1,
                  }}
                >
                  <Play size={14} fill="#fff" /> Start
                </button>
              ) : (
                <>
                  <button
                    onClick={stopSession}
                    style={{ padding: "10px 20px", borderRadius: "var(--r-sm)", border: "1px solid var(--color-border)", background: "var(--color-surface-raised)", color: "var(--color-text-muted)", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                  >
                    <Square size={12} fill="currentColor" /> Stop
                  </button>
                  <button
                    onClick={skipSession}
                    style={{ padding: "10px 20px", borderRadius: "var(--r-sm)", border: "none", background: activeColor, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                  >
                    <SkipForward size={12} /> Done Early
                  </button>
                </>
              )}
            </div>

            {/* Mini stats row */}
            {stats && (
              <div style={{ display: "flex", gap: "var(--sp-4)", marginTop: "var(--sp-2)", flexWrap: "wrap", justifyContent: "center" }}>
                {[
                  { label: "Today",    value: fmtDuration(stats.today_minutes) },
                  { label: "This Week", value: fmtDuration(stats.week_total_minutes) },
                  { label: "Sessions", value: `${stats.week_completed}/${stats.week_sessions}` },
                  { label: "Streak",   value: `${stats.current_streak_days}d` },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ───────────────────────────────────────────── */}
        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Full stats */}
            {stats && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderBottom: "var(--border)" }}>
                {[
                  { label: "Week Focus",    value: fmtDuration(stats.week_total_minutes) },
                  { label: "Longest Streak", value: `${stats.longest_streak_days}d` },
                  { label: "Peak Hour",     value: fmtHour(stats.most_productive_hour) },
                ].map(s => (
                  <div key={s.label} style={{ padding: "var(--sp-3)", background: "var(--color-bg)", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>{s.value}</div>
                    <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Refresh */}
            <div style={{ padding: "var(--sp-2) var(--sp-4)", borderBottom: "var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="sj-label">Recent Sessions</span>
              <button onClick={loadHistory} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
                <RefreshCw size={11} className={histLoading ? "sj-spin" : undefined} />
              </button>
            </div>

            {histLoading ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
            ) : sessions.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>⏱️</div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No focus sessions yet. Start one on the Timer tab.</p>
              </div>
            ) : sessions.map(s => {
              const typeColor = SESSION_PRESETS.find(p => p.type === s.type)?.color || "#6b7280";
              const isComplete = s.status === "completed";
              return (
                <div key={s.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: isComplete ? typeColor : "var(--color-surface-raised)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.task_title || "Untitled"}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                      {fmtDuration(s.actual_minutes || s.duration_minutes)} · {s.type} · {new Date(s.started_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9, padding: "2px 8px", borderRadius: "var(--r-full)", fontWeight: 600,
                    background: isComplete ? `${typeColor}18` : "var(--color-surface-raised)",
                    border: `1px solid ${isComplete ? typeColor + "44" : "var(--color-border)"}`,
                    color: isComplete ? typeColor : "var(--color-text-muted)",
                  }}>
                    {isComplete ? "✓ done" : s.status}
                  </span>
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
