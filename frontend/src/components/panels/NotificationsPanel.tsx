"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Check, CheckCheck, Trash2, Info, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  created_at: string | null;
  job_run_id: string | null;
}

function TypeIcon({ type }: { type: string }) {
  const size = 12;
  if (type === "error")   return <XCircle size={size} style={{ color: "#e25c5c", flexShrink: 0 }} />;
  if (type === "warning") return <AlertTriangle size={size} style={{ color: "#e2a94b", flexShrink: 0 }} />;
  if (type === "success") return <CheckCircle2 size={size} style={{ color: "var(--color-accent)", flexShrink: 0 }} />;
  return <Info size={size} style={{ color: "var(--color-icon)", flexShrink: 0 }} />;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationsPanel() {
  const [notifs, setNotifs]   = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<"all" | "unread">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/notifications/`);
      const data = await res.json();
      setNotifs(data.notifications ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    try {
      await fetch(`${API}/api/notifications/${id}/read`, { method: "PATCH" });
      setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    try {
      await fetch(`${API}/api/notifications/read-all`, { method: "PATCH" });
      setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  }

  async function deleteNotif(id: string) {
    try {
      await fetch(`${API}/api/notifications/${id}`, { method: "DELETE" });
      setNotifs((prev) => prev.filter((n) => n.id !== id));
    } catch { /* ignore */ }
  }

  async function clearAll() {
    try {
      await fetch(`${API}/api/notifications/`, { method: "DELETE" });
      setNotifs([]);
    } catch { /* ignore */ }
  }

  const visible = filter === "unread" ? notifs.filter((n) => !n.read) : notifs;
  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Bell size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Notifications</span>
        {unreadCount > 0 && (
          <span style={{
            marginLeft: "var(--sp-1)", background: "#f87171", color: "#fff",
            fontSize: 9, fontWeight: 700, borderRadius: 99, padding: "1px 5px",
          }}>
            {unreadCount}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)" }}>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              title="Mark all read"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex", alignItems: "center", gap: 3, fontSize: 10 }}
            >
              <CheckCheck size={11} /> All read
            </button>
          )}
          {notifs.length > 0 && (
            <button
              onClick={clearAll}
              title="Clear all"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 3, fontSize: 10 }}
            >
              <Trash2 size={11} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="sj-panel-body sj-flex-col sj-gap-3" style={{ flex: 1, overflowY: "auto" }}>
        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "var(--sp-1)" }}>
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--color-border)",
                background: filter === f ? "var(--color-accent)" : "var(--color-surface-2)",
                color: filter === f ? "#fff" : "var(--color-text-muted)", cursor: "pointer",
              }}
            >
              {f === "all" ? `All (${notifs.length})` : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="sj-micro">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="sj-micro" style={{ paddingTop: "var(--sp-2)" }}>
            {filter === "unread" ? "No unread notifications." : "No notifications yet."}
          </p>
        ) : (
          <div className="sj-flex-col sj-gap-1">
            {visible.map((n) => (
              <div
                key={n.id}
                className="sj-card"
                style={{
                  padding: "var(--sp-2) var(--sp-3)",
                  background: n.read ? undefined : "var(--color-surface-2)",
                  borderLeft: n.read ? undefined : `2px solid var(--color-accent)`,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <TypeIcon type={n.type} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text)", fontWeight: n.read ? 400 : 600 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2, whiteSpace: "pre-wrap" }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--sp-1)", flexShrink: 0 }}>
                    {!n.read && (
                      <button
                        onClick={() => markRead(n.id)}
                        title="Mark read"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", padding: 0 }}
                      >
                        <Check size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotif(n.id)}
                      title="Delete"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 0 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
