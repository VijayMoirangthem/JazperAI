"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Plus, Trash2, Clock, RefreshCw, Check, AlarmClock } from "lucide-react";

const API = "http://localhost:8000";

interface Reminder {
  id: string;
  title: string;
  body: string;
  remind_at: string | null;
  related_type: string;
  related_id: string;
  status: "pending" | "fired" | "dismissed" | "snoozed";
  created_at: string | null;
}

function fmtRemindAt(ts: string | null): { label: string; urgency: "overdue" | "today" | "soon" | "future" } {
  if (!ts) return { label: "No time set", urgency: "future" };
  const d    = new Date(ts);
  const now  = new Date();
  const diff = d.getTime() - now.getTime();
  const absS = Math.abs(diff) / 1000;

  if (diff < 0) {
    if (absS < 3600)  return { label: `${Math.floor(absS / 60)}m overdue`, urgency: "overdue" };
    if (absS < 86400) return { label: `${Math.floor(absS / 3600)}h overdue`, urgency: "overdue" };
    return { label: `${Math.floor(absS / 86400)}d overdue`, urgency: "overdue" };
  }
  if (diff < 3600_000)  return { label: `in ${Math.floor(diff / 60_000)}m`, urgency: "today" };
  if (diff < 86400_000) return { label: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), urgency: "today" };
  if (diff < 604800_000) {
    const day = d.toLocaleDateString([], { weekday: "short" });
    return { label: `${day} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, urgency: "soon" };
  }
  return { label: d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), urgency: "future" };
}

const URGENCY_COLOR = {
  overdue: "#ef4444",
  today:   "#f59e0b",
  soon:    "#6366f1",
  future:  "var(--color-text-muted)",
};

export function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<"pending" | "all">("pending");
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);

  const [newTitle, setNewTitle]     = useState("");
  const [newBody, setNewBody]       = useState("");
  const [newRemindAt, setNewRemindAt] = useState("");

  const load = useCallback(async (f = filter) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reminders?status=${f}&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(filter); }, [load, filter]);

  async function createReminder() {
    if (!newTitle.trim() || !newRemindAt) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, body: newBody, remind_at: newRemindAt }),
      });
      setNewTitle(""); setNewBody(""); setNewRemindAt("");
      setShowForm(false);
      await load(filter);
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, status: status as Reminder["status"] } : r));
    try {
      await fetch(`${API}/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (filter === "pending" && status !== "pending") {
        setReminders(prev => prev.filter(r => r.id !== id));
      }
    } catch { load(filter); }
  }

  async function deleteReminder(id: string) {
    setReminders(prev => prev.filter(r => r.id !== id));
    try {
      await fetch(`${API}/api/reminders/${id}`, { method: "DELETE" });
    } catch { load(filter); }
  }

  // Default datetime: 1 hour from now
  function defaultRemindAt() {
    const d = new Date(Date.now() + 3600_000);
    return d.toISOString().slice(0, 16);
  }

  const overdue = reminders.filter(r => r.remind_at && new Date(r.remind_at) < new Date() && r.status === "pending");

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Bell size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Reminders</span>
        {overdue.length > 0 && (
          <span style={{
            marginLeft: "var(--sp-2)", fontSize: 9, fontWeight: 700,
            background: "#ef444422", color: "#ef4444",
            border: "1px solid #ef444444", borderRadius: "var(--r-full)", padding: "1px 6px",
          }}>
            {overdue.length} overdue
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)" }}>
          <button
            onClick={() => { setShowForm(v => !v); if (!showForm) setNewRemindAt(defaultRemindAt()); }}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "3px 8px", borderRadius: "var(--r-sm)",
              background: "var(--color-accent)", border: "none",
              color: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 500,
            }}
          >
            <Plus size={10} /> Add
          </button>
          <button
            onClick={() => load(filter)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
          >
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
        </div>
      </div>

      {/* Quick add form */}
      {showForm && (
        <div style={{
          padding: "var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0,
          background: "var(--color-surface-raised)", display: "flex", flexDirection: "column", gap: "var(--sp-2)",
        }}>
          <input
            className="sj-input"
            placeholder="Reminder title…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            autoFocus
            style={{ fontSize: 12 }}
          />
          <input
            className="sj-input"
            placeholder="Details (optional)"
            value={newBody}
            onChange={e => setNewBody(e.target.value)}
            style={{ fontSize: 12 }}
          />
          <input
            className="sj-input"
            type="datetime-local"
            value={newRemindAt}
            onChange={e => setNewRemindAt(e.target.value)}
            style={{ fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowForm(false)}
              style={{ padding: "5px 12px", borderRadius: "var(--r-sm)", fontSize: 11, background: "none", border: "var(--border)", cursor: "pointer", color: "var(--color-text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={createReminder}
              disabled={!newTitle.trim() || !newRemindAt || saving}
              style={{
                padding: "5px 14px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
                background: "var(--color-accent)", border: "none", color: "#fff",
                cursor: newTitle.trim() && newRemindAt && !saving ? "pointer" : "not-allowed",
                opacity: newTitle.trim() && newRemindAt ? 1 : 0.5,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <AlarmClock size={11} /> {saving ? "Saving…" : "Set Reminder"}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0 }}>
        {(["pending", "all"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "4px 12px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
              border: "none", cursor: "pointer", textTransform: "capitalize",
              background: filter === f ? "var(--color-surface-raised)" : "none",
              color: filter === f ? "var(--color-text)" : "var(--color-text-muted)",
            }}
          >
            {f === "pending" ? "Upcoming" : "All"}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)", alignSelf: "center" }}>
          {reminders.length} reminder{reminders.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : reminders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>⏰</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {filter === "pending" ? "No upcoming reminders. Click Add to create one." : "No reminders yet."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {reminders.map(r => {
              const { label, urgency } = fmtRemindAt(r.remind_at);
              const accentColor = URGENCY_COLOR[urgency];
              return (
                <div
                  key={r.id}
                  style={{
                    padding: "var(--sp-3)",
                    borderBottom: "1px solid var(--color-border-lo)",
                    borderLeft: `3px solid ${urgency === "overdue" ? "#ef4444" : "transparent"}`,
                    opacity: r.status === "dismissed" || r.status === "fired" ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)", marginBottom: r.body ? "var(--sp-1)" : 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", marginBottom: 2 }}>
                        {r.title}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
                        <Clock size={10} style={{ color: accentColor, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: accentColor, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                          {label}
                        </span>
                        {r.status !== "pending" && (
                          <span style={{
                            fontSize: 9, marginLeft: "var(--sp-2)", padding: "1px 5px",
                            borderRadius: "var(--r-full)", textTransform: "capitalize",
                            background: "var(--color-surface-raised)", color: "var(--color-text-muted)",
                            border: "var(--border)",
                          }}>
                            {r.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    {r.status === "pending" && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => updateStatus(r.id, "snoozed")}
                          title="Snooze 1 hour"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 3, fontSize: 10 }}
                        >
                          +1h
                        </button>
                        <button
                          onClick={() => updateStatus(r.id, "dismissed")}
                          title="Dismiss"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 3, display: "flex" }}
                        >
                          <Check size={11} />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => deleteReminder(r.id)}
                      title="Delete"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 3, display: "flex", flexShrink: 0 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {r.body && (
                    <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "var(--sp-1) 0 0", lineHeight: 1.5 }}>
                      {r.body}
                    </p>
                  )}
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
