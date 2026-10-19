"use client";

import { useState, useEffect, useCallback } from "react";
import { History, Trash2, Edit2, Check, X, RefreshCw, MessageSquare } from "lucide-react";
import type { LoadedSession } from "./ChatPanel";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface HistoryPanelProps {
  onLoadSession: (session: LoadedSession) => void;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDate(sessions: Session[]): { label: string; items: Session[] }[] {
  const now = Date.now();
  const day = 86400000;
  const groups = [
    { label: "Today",      cutoff: now - day,      items: [] as Session[] },
    { label: "Yesterday",  cutoff: now - 2 * day,  items: [] as Session[] },
    { label: "This Week",  cutoff: now - 7 * day,  items: [] as Session[] },
    { label: "This Month", cutoff: now - 30 * day, items: [] as Session[] },
    { label: "Older",      cutoff: 0,              items: [] as Session[] },
  ];

  for (const s of sessions) {
    const t = new Date(s.updated_at).getTime();
    const g = groups.find(g => t > g.cutoff);
    if (g) g.items.push(s);
  }

  return groups.filter(g => g.items.length > 0);
}

export function HistoryPanel({ onLoadSession }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/history/`);
      const d = await r.json();
      setSessions(d.sessions ?? []);
    } catch { /* backend offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openSession(id: string) {
    setLoadingId(id);
    try {
      const r = await fetch(`${API}/api/history/${id}`);
      const d = await r.json();
      onLoadSession({ sessionId: id, messages: d.messages ?? [] });
    } catch (e) {
      console.error("Failed to load session", e);
    }
    setLoadingId(null);
  }

  async function deleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await fetch(`${API}/api/history/${id}`, { method: "DELETE" });
    setSessions(prev => prev.filter(s => s.id !== id));
  }

  async function saveRename(id: string) {
    if (!editVal.trim()) return;
    await fetch(`${API}/api/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editVal.trim() }),
    });
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editVal.trim() } : s));
    setEditId(null);
  }

  const groups = groupByDate(sessions);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <History size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Chat History</span>
        <div className="sj-ml-auto sj-flex sj-items-center sj-gap-2">
          <span className="sj-micro">{sessions.length} conversations</span>
          <button className="sj-btn-icon" onClick={load} title="Refresh">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-3) var(--sp-4)" }}>
        {loading && (
          <p className="sj-micro" style={{ color: "var(--color-text-muted)", padding: "var(--sp-4) 0" }}>Loading...</p>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: "var(--sp-2)" }}>
            <MessageSquare size={28} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            <p className="sj-subheading" style={{ opacity: 0.5 }}>No conversations yet</p>
            <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>Start chatting and your sessions will appear here.</p>
          </div>
        )}

        {groups.map(group => (
          <div key={group.label} style={{ marginBottom: "var(--sp-4)" }}>
            <p className="sj-micro" style={{
              color: "var(--color-text-muted)", fontWeight: 600, letterSpacing: "0.05em",
              textTransform: "uppercase", marginBottom: "var(--sp-2)", paddingLeft: 2,
            }}>
              {group.label}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {group.items.map(s => (
                <div
                  key={s.id}
                  onClick={() => editId !== s.id && openSession(s.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--sp-2)",
                    padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--r-md)",
                    cursor: loadingId === s.id ? "wait" : "pointer",
                    background: loadingId === s.id ? "var(--color-surface-raised)" : "transparent",
                    transition: "var(--ease-snap)",
                    opacity: loadingId && loadingId !== s.id ? 0.5 : 1,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-raised)")}
                  onMouseLeave={e => (e.currentTarget.style.background = loadingId === s.id ? "var(--color-surface-raised)" : "transparent")}
                >
                  {/* Title / edit inline */}
                  {editId === s.id ? (
                    <input
                      className="sj-input"
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveRename(s.id);
                        if (e.key === "Escape") setEditId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                      style={{ flex: 1, fontSize: 12, padding: "2px 6px" }}
                    />
                  ) : (
                    <p style={{
                      flex: 1, fontSize: 12, color: "var(--color-text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      lineHeight: 1.4,
                    }}>
                      {s.title}
                    </p>
                  )}

                  {/* Meta + actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                    onClick={e => e.stopPropagation()}>

                    {editId === s.id ? (
                      <>
                        <button className="sj-btn-icon" onClick={() => saveRename(s.id)} title="Save"><Check size={10} /></button>
                        <button className="sj-btn-icon" onClick={() => setEditId(null)} title="Cancel"><X size={10} /></button>
                      </>
                    ) : (
                      <>
                        <span className="sj-micro" style={{ fontSize: 10 }}>{timeAgo(s.updated_at)}</span>
                        <span className="sj-micro" style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                          {s.message_count} msgs
                        </span>
                        <button
                          className="sj-btn-icon"
                          onClick={() => { setEditId(s.id); setEditVal(s.title); }}
                          title="Rename"
                          style={{ opacity: 0.6 }}
                        >
                          <Edit2 size={10} />
                        </button>
                        <button
                          className="sj-btn-icon"
                          onClick={e => deleteSession(e, s.id)}
                          title="Delete"
                          style={{ opacity: 0.6, color: "var(--color-error, #f87171)" }}
                        >
                          <Trash2 size={10} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
