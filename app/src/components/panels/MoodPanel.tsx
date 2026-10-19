"use client";

import { useState, useEffect, useCallback } from "react";
import { Smile, RefreshCw, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface MoodEntry {
  id: string;
  energy: number;
  mood: number;
  note: string;
  logged_at: string;
}

interface MoodStats {
  entries: MoodEntry[];
  avg_energy: number;
  avg_mood: number;
  trend: {
    energy_delta: number;
    mood_delta: number;
  };
  best_day: string | null;
  correlation_hint: string | null;
}

const ENERGY_LABELS = ["", "Low", "Below avg", "Average", "Good", "Peak"];
const MOOD_LABELS   = ["", "Low", "Below avg", "Average", "Good", "Great"];

const ENERGY_EMOJI = ["", "😴", "😑", "😐", "🙂", "⚡"];
const MOOD_EMOJI   = ["", "😞", "😕", "😐", "😊", "😄"];

function RatingPicker({ value, onChange, emojis, labels, color }: {
  value: number; onChange: (v: number) => void;
  emojis: string[]; labels: string[]; color: string;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "center" }}>
      {[1, 2, 3, 4, 5].map(v => (
        <button
          key={v}
          onClick={() => onChange(v)}
          title={labels[v]}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            padding: "var(--sp-2)", borderRadius: "var(--r-sm)",
            border: value === v ? `2px solid ${color}` : "2px solid transparent",
            background: value === v ? `${color}18` : "var(--color-surface-raised)",
            cursor: "pointer", minWidth: 50, transition: "all 0.15s",
          }}
        >
          <span style={{ fontSize: 22 }}>{emojis[v]}</span>
          <span style={{ fontSize: 9, color: value === v ? color : "var(--color-text-muted)", fontWeight: value === v ? 700 : 400 }}>
            {labels[v]}
          </span>
        </button>
      ))}
    </div>
  );
}

function TrendIcon({ delta }: { delta: number }) {
  if (delta > 0.2)  return <TrendingUp  size={12} style={{ color: "#22c55e" }} />;
  if (delta < -0.2) return <TrendingDown size={12} style={{ color: "#ef4444" }} />;
  return <Minus size={12} style={{ color: "#6b7280" }} />;
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ width: 6, height: 6 + i * 3, borderRadius: 2, background: i <= value ? color : "var(--color-surface-raised)" }} />
      ))}
    </div>
  );
}

function fmtDate(ts: string) {
  try { return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return ""; }
}

function fmtDay(ts: string) {
  try { return new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
  catch { return ""; }
}

export function MoodPanel() {
  const toast = useToast();

  const [tab, setTab]           = useState<"log" | "history">("log");
  const [energy, setEnergy]     = useState(0);
  const [mood, setMood]         = useState(0);
  const [note, setNote]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [todayDone, setTodayDone] = useState(false);

  const [stats, setStats]       = useState<MoodStats | null>(null);
  const [loading, setLoading]   = useState(false);
  const [days, setDays]         = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, todayRes] = await Promise.all([
        fetch(`${API}/api/mood?days=${days}`),
        fetch(`${API}/api/mood/today`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (todayRes.ok) {
        const d = await todayRes.json();
        if (d.entry) {
          setTodayDone(true);
          setEnergy(d.entry.energy);
          setMood(d.entry.mood);
          setNote(d.entry.note || "");
        }
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!energy || !mood) { toast("Select both energy and mood", "warning"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/mood`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ energy, mood, note }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Mood logged!", "success");
      setTodayDone(true);
      load();
      setTab("history");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setSaving(false); }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Smile size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Mood & Energy</span>
        {todayDone && (
          <span style={{ marginLeft: "var(--sp-2)", fontSize: 9, background: "#22c55e18", border: "1px solid #22c55e44", color: "#22c55e", padding: "1px 7px", borderRadius: "var(--r-full)", fontWeight: 600 }}>
            ✓ Logged today
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {(["log", "history"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 11,
              background: tab === t ? "var(--color-surface-raised)" : "none",
              color: tab === t ? "var(--color-text)" : "var(--color-text-muted)",
            }}>
              {t === "log" ? "Log" : "History"}
            </button>
          ))}
        </div>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>

        {/* ── LOG TAB ───────────────────────────────────────────────── */}
        {tab === "log" && (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-4)", maxWidth: 480, margin: "0 auto" }}>
            {todayDone && (
              <div style={{ padding: "var(--sp-3)", background: "#22c55e12", border: "1px solid #22c55e44", borderRadius: "var(--r-sm)", fontSize: 12, color: "#22c55e" }}>
                ✓ You&apos;ve already logged today. Showing your current entry below.
              </div>
            )}

            <div>
              <p className="sj-label" style={{ marginBottom: "var(--sp-2)", textAlign: "center" }}>Energy Level</p>
              <RatingPicker value={energy} onChange={setEnergy} emojis={ENERGY_EMOJI} labels={ENERGY_LABELS} color="#f59e0b" />
            </div>

            <div>
              <p className="sj-label" style={{ marginBottom: "var(--sp-2)", textAlign: "center" }}>Mood</p>
              <RatingPicker value={mood} onChange={setMood} emojis={MOOD_EMOJI} labels={MOOD_LABELS} color="#8b5cf6" />
            </div>

            <textarea
              className="sj-input"
              placeholder="Optional note — what&apos;s on your mind?"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              style={{ fontSize: 12, resize: "vertical" }}
            />

            <button
              onClick={save}
              disabled={saving || !energy || !mood}
              style={{
                padding: "10px", borderRadius: "var(--r-sm)", border: "none",
                background: saving || !energy || !mood ? "var(--color-surface-raised)" : "var(--color-accent)",
                color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: saving || !energy || !mood ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)",
                opacity: !energy || !mood ? 0.5 : 1,
              }}
            >
              {saving ? <><Loader2 size={14} className="sj-spin" /> Saving…</> : `${todayDone ? "Update" : "Log"} Today's Check-in`}
            </button>
          </div>
        )}

        {/* ── HISTORY TAB ───────────────────────────────────────────── */}
        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Stats cards */}
            {stats && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--color-border)", borderBottom: "var(--border)" }}>
                  {[
                    { label: "Avg Energy", value: stats.avg_energy?.toFixed(1) || "—", emoji: ENERGY_EMOJI[Math.round(stats.avg_energy)] || "⚡", color: "#f59e0b", delta: stats.trend?.energy_delta },
                    { label: "Avg Mood",   value: stats.avg_mood?.toFixed(1) || "—",   emoji: MOOD_EMOJI[Math.round(stats.avg_mood)] || "😊",     color: "#8b5cf6", delta: stats.trend?.mood_delta },
                  ].map(s => (
                    <div key={s.label} style={{ padding: "var(--sp-3)", background: "var(--color-bg)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                      <span style={{ fontSize: 24 }}>{s.emoji}</span>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono)", color: s.color }}>{s.value}</span>
                          {s.delta !== undefined && <TrendIcon delta={s.delta} />}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {(stats.best_day || stats.correlation_hint) && (
                  <div style={{ padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                    {stats.best_day && (
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        🏆 Best day: <strong style={{ color: "var(--color-text)" }}>{fmtDay(stats.best_day)}</strong>
                      </span>
                    )}
                    {stats.correlation_hint && (
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        💡 {stats.correlation_hint}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Days selector */}
            <div style={{ padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <span className="sj-label" style={{ fontSize: 10 }}>Range:</span>
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setDays(d)} style={{
                  padding: "2px 8px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 10,
                  background: days === d ? "var(--color-surface-raised)" : "none",
                  color: days === d ? "var(--color-text)" : "var(--color-text-muted)",
                }}>
                  {d}d
                </button>
              ))}
              <button onClick={load} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
                <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
              </button>
            </div>

            {loading ? (
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
            ) : !stats || stats.entries.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
                <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>📊</div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No mood entries yet. Log your first check-in on the Log tab.</p>
              </div>
            ) : stats.entries.map(e => (
              <div key={e.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)", display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{MOOD_EMOJI[e.mood]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                      <span style={{ fontSize: 9, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Energy</span>
                      <MiniBar value={e.energy} color="#f59e0b" />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                      <span style={{ fontSize: 9, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.04em" }}>Mood</span>
                      <MiniBar value={e.mood} color="#8b5cf6" />
                    </div>
                  </div>
                  {e.note && <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note}</p>}
                </div>
                <span style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{fmtDate(e.logged_at)}</span>
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
