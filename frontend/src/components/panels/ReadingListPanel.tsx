"use client";

import { useState, useEffect, useCallback } from "react";
import { BookMarked, Plus, Trash2, RefreshCw, Check, ExternalLink, Loader2, Tag } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type ReadStatus = "unread" | "read" | "archived";

interface ReadingItem {
  id: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  status: ReadStatus;
  added_at: string;
}

const STATUS_META: Record<ReadStatus, { label: string; color: string }> = {
  unread:   { label: "Unread",   color: "#3b82f6" },
  read:     { label: "Read",     color: "#22c55e" },
  archived: { label: "Archived", color: "#6b7280" },
};

function hostname(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return url; }
}

function fmtDate(ts: string) {
  try { return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return ""; }
}

export function ReadingListPanel() {
  const toast = useToast();

  const [items, setItems]         = useState<ReadingItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<ReadStatus | "all">("unread");
  const [adding, setAdding]       = useState(false);
  const [newUrl, setNewUrl]       = useState("");
  const [newTitle, setNewTitle]   = useState("");
  const [newTags, setNewTags]     = useState("");
  const [saving, setSaving]       = useState(false);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reading-list?status=${filter === "all" ? "all" : filter}`);
      if (res.ok) setItems((await res.json()).items || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function addItem() {
    if (!newUrl.trim()) { toast("Enter a URL first", "warning"); return; }
    setSaving(true);
    try {
      const tags = newTags.split(",").map(t => t.trim()).filter(Boolean);
      const res = await fetch(`${API}/api/reading-list`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl, title: newTitle || undefined, tags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Added to reading list", "success");
      setAdding(false); setNewUrl(""); setNewTitle(""); setNewTags("");
      load();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: ReadStatus) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    try {
      await fetch(`${API}/api/reading-list/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch { load(); }
  }

  async function deleteItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await fetch(`${API}/api/reading-list/${id}`, { method: "DELETE" }); }
    catch { load(); }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const counts = { unread: 0, read: 0, archived: 0, all: items.length };

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <BookMarked size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Reading List</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
          <button
            onClick={() => setAdding(a => !a)}
            style={{ padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={11} /> Add URL
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{ padding: "var(--sp-3)", borderBottom: "var(--border)", background: "var(--color-surface-raised)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <input className="sj-input" placeholder="URL  (https://…)" value={newUrl} onChange={e => setNewUrl(e.target.value)} autoFocus style={{ fontSize: 13 }} onKeyDown={e => e.key === "Enter" && addItem()} />
          <input className="sj-input" placeholder="Title  (optional — auto-detected)" value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ fontSize: 12 }} />
          <input className="sj-input" placeholder="Tags  (comma-separated)" value={newTags} onChange={e => setNewTags(e.target.value)} style={{ fontSize: 12 }} />
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button onClick={addItem} disabled={saving || !newUrl.trim()} style={{ flex: 1, padding: "6px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 12, cursor: "pointer", opacity: !newUrl.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              {saving ? <><Loader2 size={12} className="sj-spin" /> Saving…</> : <><Check size={12} /> Save</>}
            </button>
            <button onClick={() => setAdding(false)} style={{ padding: "6px 14px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 12, cursor: "pointer", color: "var(--color-text-muted)" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0 }}>
        {(["unread", "read", "archived", "all"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 11,
            background: filter === f ? "var(--color-surface-raised)" : "none",
            color: filter === f ? "var(--color-text)" : "var(--color-text-muted)",
          }}>
            {f === "all" ? "All" : STATUS_META[f].label}
            {f === "unread" && counts.unread > 0 && <span style={{ marginLeft: 4, fontSize: 9, background: "#3b82f618", color: "#3b82f6", padding: "1px 5px", borderRadius: "var(--r-full)", fontWeight: 700 }}>{counts.unread}</span>}
          </button>
        ))}
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>📚</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {filter === "unread" ? "Nothing to read. Add a URL above." : "No items in this view."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {items.map(item => {
              const isOpen = expanded.has(item.id);
              return (
                <div key={item.id} style={{ borderBottom: "1px solid var(--color-border-lo)" }}>
                  <div style={{ padding: "var(--sp-3)", display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                    {/* Status dot */}
                    <button
                      onClick={() => updateStatus(item.id, item.status === "read" ? "unread" : "read")}
                      style={{ width: 14, height: 14, borderRadius: "50%", border: item.status === "read" ? "none" : `2px solid ${STATUS_META[item.status]?.color || "#6b7280"}`, background: item.status === "read" ? "#22c55e" : "transparent", cursor: "pointer", flexShrink: 0, marginTop: 3, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      {item.status === "read" && <Check size={8} color="#fff" />}
                    </button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", marginBottom: 2 }}>{item.title || hostname(item.url)}</div>
                          <div style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", marginBottom: item.summary ? "var(--sp-1)" : 0 }}>
                            {hostname(item.url)} · {fmtDate(item.added_at)}
                          </div>
                        </div>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--color-icon)", flexShrink: 0 }}>
                          <ExternalLink size={11} />
                        </a>
                      </div>

                      {item.summary && (
                        <p
                          onClick={() => toggleExpand(item.id)}
                          style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "var(--sp-1) 0 0", lineHeight: 1.6, cursor: "pointer" }}
                        >
                          {isOpen ? item.summary : (item.summary.length > 100 ? item.summary.slice(0, 100) + "…" : item.summary)}
                        </p>
                      )}

                      {item.tags?.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: "var(--sp-1)" }}>
                          {item.tags.map(tag => (
                            <span key={tag} style={{ fontSize: 9, padding: "1px 6px", borderRadius: "var(--r-full)", background: "var(--color-surface-raised)", border: "var(--border)", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 2 }}>
                              <Tag size={7} /> {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "var(--sp-1)", flexShrink: 0, marginLeft: "var(--sp-1)" }}>
                      {item.status !== "archived" && (
                        <button
                          onClick={() => updateStatus(item.id, "archived")}
                          title="Archive"
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--color-text-muted)", padding: "2px 4px" }}
                        >
                          ↓
                        </button>
                      )}
                      <button onClick={() => deleteItem(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
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
