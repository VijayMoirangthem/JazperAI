"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckSquare, Plus, Trash2, Flame, RefreshCw } from "lucide-react";

const API = "http://localhost:8000/api/habits";

interface Habit {
  id: string;
  title: string;
  emoji: string;
  streak: number;
  completed_today: boolean;
  created_at: string | null;
}

const EMOJI_OPTIONS = ["✅", "💪", "📚", "🏃", "🧘", "💧", "🥗", "🛌", "✍️", "🎯"];

export function HabitsPanel() {
  const [habits, setHabits]       = useState<Habit[]>([]);
  const [loading, setLoading]     = useState(true);
  const [addMode, setAddMode]     = useState(false);
  const [title, setTitle]         = useState("");
  const [emoji, setEmoji]         = useState("✅");
  const [saving, setSaving]       = useState(false);
  const [toggling, setToggling]   = useState<string | null>(null);
  const [deleting, setDeleting]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(API);
      const data = await r.json();
      setHabits(Array.isArray(data) ? data : []);
    } catch { setHabits([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleComplete(h: Habit) {
    setToggling(h.id);
    try {
      if (h.completed_today) {
        await fetch(`${API}/${h.id}/complete`, { method: "DELETE" });
      } else {
        await fetch(`${API}/${h.id}/complete`, { method: "POST" });
      }
      setHabits(prev => prev.map(x =>
        x.id === h.id
          ? { ...x, completed_today: !x.completed_today, streak: !x.completed_today ? x.streak + 1 : Math.max(0, x.streak - 1) }
          : x
      ));
    } finally { setToggling(null); }
  }

  async function addHabit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), emoji }),
      });
      const data = await r.json();
      setHabits(prev => [...prev, data]);
      setTitle(""); setEmoji("✅"); setAddMode(false);
    } finally { setSaving(false); }
  }

  async function deleteHabit(id: string) {
    setDeleting(id);
    try {
      await fetch(`${API}/${id}`, { method: "DELETE" });
      setHabits(prev => prev.filter(h => h.id !== id));
    } finally { setDeleting(null); }
  }

  const todayDone = habits.filter(h => h.completed_today).length;
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <CheckSquare size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Habits</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={load} disabled={loading} title="Refresh"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", padding: 2 }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : ""} />
          </button>
          <button
            onClick={() => setAddMode(m => !m)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 10px", borderRadius: "var(--r-sm)",
              background: "var(--color-accent)", border: "none",
              color: "#fff", fontSize: 11, cursor: "pointer",
            }}
          >
            <Plus size={11} /> Add
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {habits.length > 0 && (
        <div style={{
          display: "flex", gap: "var(--sp-4)", padding: "var(--sp-2) var(--sp-4)",
          borderBottom: "var(--border)", flexShrink: 0,
          fontSize: 11, color: "var(--color-text-muted)",
        }}>
          <span>
            <span style={{ fontWeight: 700, color: "var(--color-text)" }}>{todayDone}/{habits.length}</span> done today
          </span>
          {bestStreak > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <Flame size={11} style={{ color: "#f97316" }} />
              <span style={{ fontWeight: 700, color: "#f97316" }}>{bestStreak}</span> best streak
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto", padding: "var(--sp-3) var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>

        {/* Add form */}
        {addMode && (
          <div className="sj-card" style={{ padding: "var(--sp-3)", marginBottom: "var(--sp-2)" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginBottom: "var(--sp-2)" }}>New Habit</p>

            {/* Emoji picker */}
            <div style={{ display: "flex", gap: "var(--sp-1)", flexWrap: "wrap", marginBottom: "var(--sp-2)" }}>
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  style={{
                    fontSize: 18, background: emoji === e ? "var(--color-surface-float)" : "transparent",
                    border: emoji === e ? "var(--border)" : "1px solid transparent",
                    borderRadius: "var(--r-sm)", cursor: "pointer", padding: "2px 4px",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>

            <input
              className="sj-input"
              placeholder="Habit name, e.g. Morning run"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addHabit(); if (e.key === "Escape") setAddMode(false); }}
              autoFocus
              style={{ marginBottom: "var(--sp-2)" }}
            />
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button
                onClick={addHabit}
                disabled={saving || !title.trim()}
                style={{
                  padding: "5px 16px", borderRadius: "var(--r-sm)",
                  background: "var(--color-accent)", border: "none",
                  color: "#fff", fontSize: 12, cursor: "pointer",
                  opacity: saving || !title.trim() ? 0.5 : 1,
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setAddMode(false); setTitle(""); setEmoji("✅"); }}
                style={{
                  padding: "5px 14px", borderRadius: "var(--r-sm)",
                  background: "transparent", border: "var(--border)",
                  color: "var(--color-text-muted)", fontSize: 12, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && habits.length === 0 && !addMode && (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "var(--sp-3)", opacity: 0.5, paddingTop: "var(--sp-6)",
          }}>
            <div style={{ fontSize: 36 }}>🎯</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
              No habits yet. Click &quot;+ Add&quot; to start building your daily routine.
            </p>
          </div>
        )}

        {/* Habit list */}
        {habits.map(h => {
          const done = h.completed_today;
          return (
            <div
              key={h.id}
              className="sj-card"
              style={{
                padding: "var(--sp-3)",
                borderLeft: done ? "2px solid var(--color-accent)" : "2px solid transparent",
                opacity: deleting === h.id ? 0.4 : 1,
                transition: "opacity 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                {/* Check button */}
                <button
                  onClick={() => toggleComplete(h)}
                  disabled={toggling === h.id}
                  title={done ? "Mark incomplete" : "Mark complete"}
                  style={{
                    width: 30, height: 30, borderRadius: "var(--r-sm)",
                    border: done ? "none" : "var(--border)",
                    background: done ? "var(--color-accent)" : "var(--color-surface-raised)",
                    cursor: toggling === h.id ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, fontSize: 16,
                    opacity: toggling === h.id ? 0.5 : 1,
                  }}
                >
                  {done ? "✓" : h.emoji}
                </button>

                {/* Title + streak */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500,
                    color: done ? "var(--color-text-muted)" : "var(--color-text)",
                    textDecoration: done ? "line-through" : "none",
                  }}>
                    {h.emoji} {h.title}
                  </span>
                  {h.streak > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 2, fontSize: 11 }}>
                      <Flame size={10} style={{ color: h.streak >= 7 ? "#ef4444" : "#f97316" }} />
                      <span style={{ color: h.streak >= 7 ? "#ef4444" : "#f97316", fontWeight: 600 }}>
                        {h.streak} day streak
                      </span>
                    </span>
                  )}
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteHabit(h.id)}
                  disabled={deleting === h.id}
                  title="Delete habit"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--color-text-muted)", padding: 2, opacity: deleting === h.id ? 0.4 : 1,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
