"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bell, Mail, Briefcase, AlertTriangle, Info,
  Check, CheckCheck, Trash2, Reply, Sparkles, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";

const API = "http://localhost:8000/api/notifications";

interface NotifMeta {
  from_email?: string;
  msg_id?: string;
  subject?: string;
}

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  created_at: string | null;
  metadata?: NotifMeta;
}

type FilterTab = "all" | "unread" | "email" | "job" | "alert";

const TYPE_COLOR: Record<string, string> = {
  email:   "#3b82f6",
  job:     "#22c55e",
  alert:   "#f59e0b",
  warning: "#f59e0b",
  info:    "var(--color-icon)",
  default: "var(--color-icon)",
};

function typeColor(t: string): string {
  return TYPE_COLOR[t] ?? TYPE_COLOR.default;
}

function TypeIcon({ type }: { type: string }) {
  const color = typeColor(type);
  const size = 13;
  if (type === "email")   return <Mail size={size} style={{ color, flexShrink: 0 }} />;
  if (type === "job")     return <Briefcase size={size} style={{ color, flexShrink: 0 }} />;
  if (type === "alert" || type === "warning")
                          return <AlertTriangle size={size} style={{ color, flexShrink: 0 }} />;
  return                         <Info size={size} style={{ color, flexShrink: 0 }} />;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all",    label: "All" },
  { key: "unread", label: "Unread" },
  { key: "email",  label: "Email" },
  { key: "job",    label: "Job" },
  { key: "alert",  label: "Alert" },
];

function applyFilter(notifs: Notification[], filter: FilterTab): Notification[] {
  if (filter === "unread") return notifs.filter((n) => !n.read);
  if (filter === "email")  return notifs.filter((n) => n.type === "email");
  if (filter === "job")    return notifs.filter((n) => n.type === "job");
  if (filter === "alert")  return notifs.filter((n) => n.type === "alert" || n.type === "warning");
  return notifs;
}

export function NotificationCenterPanel() {
  const [notifs, setNotifs]         = useState<Notification[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<FilterTab>("all");
  const [draftById, setDraftById]   = useState<Record<string, string>>({});
  const [draftLoading, setDraftLoading] = useState<Record<string, boolean>>({});
  const [draftOpen, setDraftOpen]   = useState<Record<string, boolean>>({});

  async function generateDraft(n: Notification) {
    if (!n.metadata?.from_email) return;
    setDraftLoading(prev => ({ ...prev, [n.id]: true }));
    try {
      const res = await fetch("http://localhost:8000/api/hermes/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_email: n.metadata.from_email,
          subject: n.metadata.subject || n.title,
          body_preview: n.body || "",
          tone: "professional",
        }),
      });
      const data = await res.json();
      if (data.draft) {
        setDraftById(prev => ({ ...prev, [n.id]: data.draft }));
        setDraftOpen(prev => ({ ...prev, [n.id]: true }));
      }
    } catch { /* silent */ } finally {
      setDraftLoading(prev => ({ ...prev, [n.id]: false }));
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/`);
      const data = await res.json();
      setNotifs(data.notifications ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function markRead(id: string) {
    try {
      await fetch(`${API}/${id}/read`, { method: "PATCH" });
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    try {
      await fetch(`${API}/read-all`, { method: "PATCH" });
      setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  }

  async function deleteNotif(id: string) {
    try {
      await fetch(`${API}/${id}`, { method: "DELETE" });
      setNotifs((prev) => prev.filter((n) => n.id !== id));
    } catch { /* ignore */ }
  }

  async function clearAll() {
    try {
      await fetch(`${API}/`, { method: "DELETE" });
      setNotifs([]);
    } catch { /* ignore */ }
  }

  const visible    = applyFilter(notifs, filter);
  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="sj-panel-header">
        <Bell size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Notifications</span>
        {unreadCount > 0 && (
          <span style={{
            marginLeft: "var(--sp-2)",
            background: "#f87171", color: "#fff",
            fontSize: 9, fontWeight: 700,
            borderRadius: "var(--r-full)", padding: "1px 5px",
          }}>
            {unreadCount}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              title="Mark all read"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--color-icon)", display: "flex", alignItems: "center",
                gap: 3, fontSize: 10,
              }}
            >
              <CheckCheck size={11} /> All read
            </button>
          )}
          {notifs.length > 0 && (
            <button
              onClick={clearAll}
              title="Clear all"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--color-text-muted)", display: "flex", alignItems: "center",
                gap: 3, fontSize: 10,
              }}
            >
              <Trash2 size={11} /> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: "flex", gap: "var(--sp-2)", padding: "var(--sp-3) var(--sp-4) 0",
        borderBottom: "1px solid var(--border)",
      }}>
        {FILTER_TABS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                fontSize: 11, padding: "4px 10px",
                borderRadius: "var(--r-sm) var(--r-sm) 0 0",
                border: "1px solid var(--border)",
                borderBottom: active ? "1px solid var(--color-surface-float)" : "1px solid var(--border)",
                background: active ? "var(--color-surface-float)" : "transparent",
                color: active ? "var(--color-text)" : "var(--color-text-muted)",
                cursor: "pointer",
                marginBottom: active ? -1 : 0,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div
        className="sj-panel-body"
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}
      >
        {loading ? (
          <p style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: "var(--sp-3)", opacity: 0.5,
          }}>
            <Bell size={28} style={{ color: "var(--color-icon)" }} />
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {filter === "unread" ? "No unread notifications" :
               filter === "all"   ? "No notifications yet" :
               `No ${filter} notifications`}
            </span>
          </div>
        ) : (
          visible.map((n) => (
            <div
              key={n.id}
              className="sj-card"
              style={{
                padding: "var(--sp-3)",
                borderLeft: n.read ? undefined : `2px solid ${typeColor(n.type)}`,
                background: n.read ? undefined : "var(--color-surface-raised)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-3)" }}>
                {/* Unread dot */}
                {!n.read && (
                  <div style={{
                    width: 6, height: 6, borderRadius: "var(--r-full)",
                    background: typeColor(n.type), flexShrink: 0, marginTop: 4,
                  }} />
                )}
                <TypeIcon type={n.type} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, color: "var(--color-text)",
                    fontWeight: n.read ? 400 : 600,
                  }}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div style={{
                      fontSize: 11, color: "var(--color-text-muted)",
                      marginTop: 2, lineHeight: 1.4,
                    }}>
                      {n.body.length > 120 ? n.body.slice(0, 120) + "…" : n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {timeAgo(n.created_at)}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: "flex", gap: "var(--sp-2)", flexShrink: 0, alignItems: "center" }}>
                  {n.metadata?.from_email && (
                    <>
                      <button
                        onClick={() => generateDraft(n)}
                        disabled={draftLoading[n.id]}
                        title="Draft AI reply"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent)", padding: 2, opacity: draftLoading[n.id] ? 0.5 : 1 }}
                      >
                        {draftLoading[n.id] ? <Loader2 size={11} className="sj-spin" /> : <Sparkles size={11} />}
                      </button>
                      <button
                        onClick={() => {
                          localStorage.setItem("sj_compose_prefill", JSON.stringify({
                            to: n.metadata!.from_email,
                            subject: `Re: ${n.metadata?.subject || n.title}`,
                            reply_to_id: n.metadata?.msg_id || "",
                          }));
                          window.location.hash = "compose";
                        }}
                        title="Reply to sender"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#60a5fa", padding: 2 }}
                      >
                        <Reply size={12} />
                      </button>
                    </>
                  )}
                  {!n.read && (
                    <button
                      onClick={() => markRead(n.id)}
                      title="Mark read"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", padding: 2 }}
                    >
                      <Check size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotif(n.id)}
                    title="Delete"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 2 }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {/* AI Draft panel */}
              {draftById[n.id] && (
                <div style={{
                  margin: "var(--sp-2) var(--sp-3) var(--sp-3)",
                  borderRadius: "var(--r-sm)",
                  background: "color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-raised))",
                  border: "1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)",
                  overflow: "hidden",
                }}>
                  <button
                    onClick={() => setDraftOpen(prev => ({ ...prev, [n.id]: !prev[n.id] }))}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: "var(--sp-2)",
                      padding: "var(--sp-2) var(--sp-3)", background: "none", border: "none",
                      cursor: "pointer", color: "var(--color-accent)", fontSize: 11, fontWeight: 500,
                    }}
                  >
                    <Sparkles size={10} />
                    AI Draft Reply
                    <span style={{ marginLeft: "auto" }}>
                      {draftOpen[n.id] ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </span>
                  </button>
                  {draftOpen[n.id] && (
                    <div style={{ padding: "0 var(--sp-3) var(--sp-3)" }}>
                      <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.6, margin: "0 0 var(--sp-2)" }}>
                        {draftById[n.id]}
                      </p>
                      <button
                        onClick={() => {
                          localStorage.setItem("sj_compose_prefill", JSON.stringify({
                            to: n.metadata!.from_email,
                            subject: `Re: ${n.metadata?.subject || n.title}`,
                            body: draftById[n.id],
                            reply_to_id: n.metadata?.msg_id || "",
                          }));
                          window.location.hash = "compose";
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: "4px 10px", borderRadius: "var(--r-sm)",
                          background: "var(--color-accent)", border: "none",
                          color: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 500,
                        }}
                      >
                        <Reply size={10} /> Edit &amp; Send
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
