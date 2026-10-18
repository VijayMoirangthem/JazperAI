"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, RefreshCw, ChevronDown, ChevronRight, Sparkles } from "lucide-react";

const API = "http://localhost:8000";

interface MemoryEntry {
  id: string;
  content: string;
  source_type: string;
  source_url: string | null;
  tags: string[];
  created_at: string | null;
}

function fmtDate(ts: string | null) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
}

function snippet(text: string, maxLen = 160) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

export function SagePanel() {
  const [entries, setEntries]   = useState<MemoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allMem, setAllMem]     = useState<{ core: number; extracted: number; auto: number } | null>(null);
  const [tab, setTab]           = useState<"sage" | "all">("sage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sageRes, coreRes, extRes, autoRes] = await Promise.all([
        fetch(`${API}/api/memory/sage?limit=100`),
        fetch(`${API}/api/memory/core`),
        fetch(`${API}/api/memory/extracted`),
        fetch(`${API}/api/memory/auto?limit=1`),
      ]);

      if (sageRes.ok) {
        const d = await sageRes.json();
        setEntries(d.entries || []);
      }

      // Count all memory types
      const [coreD, extD, autoD] = await Promise.all([
        coreRes.ok  ? coreRes.json()  : Promise.resolve({}),
        extRes.ok   ? extRes.json()   : Promise.resolve({}),
        autoRes.ok  ? autoRes.json()  : Promise.resolve({}),
      ]);
      setAllMem({
        core:      Array.isArray(coreD.memories) ? coreD.memories.length : 0,
        extracted: Array.isArray(extD.memories)  ? extD.memories.length  : 0,
        auto:      autoD.total ?? 0,
      });
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Brain size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Sage Memory</span>
        <span style={{ marginLeft: "var(--sp-2)", fontSize: 9, color: "var(--color-text-muted)" }}>consolidated by Sage weekly</span>
        <button
          onClick={load}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      {/* Memory health cards */}
      {allMem && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderBottom: "var(--border)", flexShrink: 0 }}>
          {[
            { label: "Sage",      value: entries.length, color: "#8b5cf6" },
            { label: "Core",      value: allMem.core,       color: "#6366f1" },
            { label: "Extracted", value: allMem.extracted,  color: "#22c55e" },
            { label: "Auto",      value: allMem.auto,       color: "#f59e0b" },
          ].map(m => (
            <div key={m.label} style={{ padding: "var(--sp-2)", textAlign: "center", background: "var(--color-bg)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: "var(--font-mono)" }}>{m.value}</div>
              <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0 }}>
        {(["sage", "all"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "4px 12px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
            border: "none", cursor: "pointer",
            background: tab === t ? "var(--color-surface-raised)" : "none",
            color: tab === t ? "var(--color-text)" : "var(--color-text-muted)",
          }}>
            {t === "sage" ? "Consolidated" : "All Memory Types"}
          </button>
        ))}
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : tab === "sage" ? (
          entries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
              <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>🧠</div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                No consolidated memories yet. Sage runs every Sunday at 02:00 UTC to synthesize your extracted memories into deeper insights.
              </p>
              <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-2)" }}>
                Keep chatting — Sage consolidates from your conversation extractions.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {entries.map(e => {
                const isOpen = expanded.has(e.id);
                return (
                  <div key={e.id} style={{ borderBottom: "1px solid var(--color-border-lo)" }}>
                    <div
                      onClick={() => toggleExpand(e.id)}
                      style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)", padding: "var(--sp-3)", cursor: "pointer" }}
                    >
                      <Sparkles size={12} style={{ color: "#8b5cf6", flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.6, margin: 0 }}>
                          {isOpen ? e.content : snippet(e.content)}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                          <span style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                            {fmtDate(e.created_at)}
                          </span>
                          {e.tags?.length > 0 && e.tags.slice(0, 3).map(tag => (
                            <span key={tag} style={{
                              fontSize: 9, padding: "1px 5px", borderRadius: "var(--r-full)",
                              background: "#8b5cf618", border: "1px solid #8b5cf644", color: "#a78bfa",
                            }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      {isOpen
                        ? <ChevronDown size={11} style={{ color: "var(--color-icon)", flexShrink: 0 }} />
                        : <ChevronRight size={11} style={{ color: "var(--color-icon)", flexShrink: 0 }} />
                      }
                    </div>
                  </div>
                );
              })}
              <div style={{ height: "var(--sp-4)" }} />
            </div>
          )
        ) : (
          /* All memory types info */
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {[
              { label: "Core Memory", icon: "💎", desc: "Manually set facts about you — always injected into every chat. Edit in the Memory panel.", nav: "memory", color: "#6366f1" },
              { label: "Extracted Memory", icon: "⚡", desc: "Auto-extracted from conversations by Sage. Key facts, preferences, and patterns.", nav: "memory", color: "#22c55e" },
              { label: "Consolidated (Sage)", icon: "🔮", desc: "Sage synthesizes extracted memories weekly into deeper, durable insights shown in this panel.", nav: null, color: "#8b5cf6" },
              { label: "Knowledge Base", icon: "📚", desc: "Documents, URLs, and notes you've added manually. RAG-searched on every chat message.", nav: "knowledge", color: "#f59e0b" },
            ].map(m => (
              <div
                key={m.label}
                className="sj-card"
                onClick={() => m.nav && (window.location.hash = m.nav)}
                style={{ cursor: m.nav ? "pointer" : "default" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                  <span style={{ fontSize: 18 }}>{m.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{m.label}</span>
                  {m.nav && <ChevronRight size={12} style={{ color: "var(--color-icon)", marginLeft: "auto" }} />}
                </div>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6, margin: 0 }}>{m.desc}</p>
              </div>
            ))}
            <div style={{ padding: "var(--sp-3)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--color-text)" }}>RAG re-ranking active:</strong> Knowledge entries are now ranked by a blend of semantic relevance (85%) and recency (15%) — fresher knowledge surfaces first.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
