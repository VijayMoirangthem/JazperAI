"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Send, BookmarkPlus, BookmarkCheck, Trash2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase   = { id: string; name: string; status: "done" | "next" | "upcoming" };
type Feature = { name: string; agents: string[]; status: string; description: string };
type Agent   = { name: string; emoji: string; description: string; model: string };
type Stats   = Record<string, number>;
type ChatMsg = { role: "user" | "assistant"; content: string };
type Note    = { id: string; title: string; created_at: string };

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  done:     { bg: "#14532d", color: "#4ade80", label: "done"     },
  live:     { bg: "#14532d", color: "#4ade80", label: "live"     },
  next:     { bg: "#78350f", color: "#fbbf24", label: "next"     },
  upcoming: { bg: "#1c1c2e", color: "#94a3b8", label: "upcoming" },
  planned:  { bg: "#1c1c2e", color: "#94a3b8", label: "planned"  },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.upcoming;
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
      padding: "2px 6px", borderRadius: 4, textTransform: "uppercase",
      flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, count, defaultOpen = true, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          padding: "6px 0", color: "var(--color-text)",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7 }}>
          {title}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 2 }}>({count})</span>
        )}
      </button>
      {open && <div style={{ paddingLeft: 18 }}>{children}</div>}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "8px 14px", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: 6, minWidth: 70,
    }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: "var(--color-accent)" }}>{value}</span>
      <span style={{ fontSize: 9, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</span>
    </div>
  );
}

// ── Mini-chat ─────────────────────────────────────────────────────────────────

function MiniChat() {
  const [msgs,    setMsgs]    = useState<ChatMsg[]>([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [save,    setSave]    = useState(false);
  const [notes,   setNotes]   = useState<Note[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/roadmap/notes`);
      const d = await r.json();
      setNotes(d.notes ?? []);
    } catch { /* offline */ }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: ChatMsg = { role: "user", content: text };
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs);
    setLoading(true);
    scrollBottom();

    let reply = "";
    const assistantMsg: ChatMsg = { role: "assistant", content: "" };
    setMsgs([...newMsgs, assistantMsg]);

    try {
      const res = await fetch(`${API}/api/roadmap/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: msgs.slice(-8) }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const obj = JSON.parse(payload);
            if (obj.text) {
              reply += obj.text;
              setMsgs(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: reply };
                return updated;
              });
              scrollBottom();
            }
          } catch { /* partial JSON */ }
        }
      }
    } catch (e: any) {
      setMsgs(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: `Error: ${e.message}` };
        return updated;
      });
    }

    setLoading(false);

    if (save && reply) {
      const finalMsgs = [...newMsgs, { role: "assistant" as const, content: reply }];
      try {
        await fetch(`${API}/api/roadmap/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: text.slice(0, 60),
            messages: finalMsgs,
          }),
        });
        loadNotes();
      } catch { /* offline */ }
    }
  }

  async function deleteNote(id: string) {
    try {
      await fetch(`${API}/api/roadmap/notes/${id}`, { method: "DELETE" });
      setNotes(n => n.filter(x => x.id !== id));
    } catch { /* offline */ }
  }

  function loadNote(note: Note) {
    // fetch full note not needed — just show the title as context indicator
    setShowNotes(false);
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: 8, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Ask Jazper
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => { setShowNotes(s => !s); if (!showNotes) loadNotes(); }}
            title="Saved notes"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text)", opacity: 0.5, fontSize: 10, padding: "2px 6px" }}
          >
            {notes.length > 0 ? `${notes.length} saved` : "notes"}
          </button>
          <button
            onClick={() => setSave(s => !s)}
            title={save ? "Auto-save on" : "Auto-save off"}
            style={{ background: "none", border: "none", cursor: "pointer", color: save ? "var(--color-accent)" : "var(--color-text)", opacity: save ? 1 : 0.4 }}
          >
            {save ? <BookmarkCheck size={13} /> : <BookmarkPlus size={13} />}
          </button>
        </div>
      </div>

      {/* Notes drawer */}
      {showNotes && (
        <div style={{
          borderBottom: "1px solid var(--color-border)",
          maxHeight: 150, overflowY: "auto", padding: "6px 10px",
        }}>
          {notes.length === 0 ? (
            <p style={{ fontSize: 11, opacity: 0.4, margin: 0 }}>No saved notes yet.</p>
          ) : notes.map(n => (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
              <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.8 }}>
                {n.title}
              </span>
              <span style={{ fontSize: 9, opacity: 0.4, flexShrink: 0 }}>
                {new Date(n.created_at).toLocaleDateString()}
              </span>
              <button
                onClick={() => deleteNote(n.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", padding: 2, opacity: 0.7 }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.length === 0 && (
          <div style={{ opacity: 0.35, fontSize: 11, marginTop: 8 }}>
            <p style={{ margin: 0 }}>Ask anything about the platform —</p>
            <p style={{ margin: "2px 0 0" }}>agents, features, roadmap, architecture.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "88%",
          }}>
            <div style={{
              background: m.role === "user" ? "var(--color-accent)" : "var(--color-bg)",
              color: m.role === "user" ? "#000" : "var(--color-text)",
              borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              padding: "7px 11px", fontSize: 12, lineHeight: 1.5,
              border: m.role === "assistant" ? "1px solid var(--color-border)" : "none",
            }}>
              {m.content || (loading && i === msgs.length - 1 ? "▌" : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "8px 10px", borderTop: "1px solid var(--color-border)",
        display: "flex", gap: 6,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="What does Scout do?"
          disabled={loading}
          style={{
            flex: 1, background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: 6, padding: "6px 10px", fontSize: 12, color: "var(--color-text)",
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            background: "var(--color-accent)", border: "none", borderRadius: 6,
            padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center",
            opacity: loading || !input.trim() ? 0.4 : 1,
          }}
        >
          <Send size={12} color="#000" />
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function RoadmapPanel() {
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [ctx,     setCtx]     = useState<{ agents: Agent[]; features: Feature[]; phases: Phase[]; recent_errors: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [sr, cr] = await Promise.all([
          fetch(`${API}/api/roadmap/stats`),
          fetch(`${API}/api/roadmap/context`),
        ]);
        const [s, c] = await Promise.all([sr.json(), cr.json()]);
        setStats(s);
        setCtx(c);
      } catch { /* backend offline — show fallback */ }
      setLoading(false);
    }
    load();
  }, []);

  const phases   = ctx?.phases   ?? [];
  const features = ctx?.features ?? [];
  const agents   = ctx?.agents   ?? [];
  const errors   = ctx?.recent_errors ?? [];

  const nextItems = [
    "Jazper creates and tracks multi-step plans over hours",
    "Human confirmation before destructive agent actions (approval_required notification)",
    "Inter-agent messaging — Hermes alerts Atlas when recruiter replies",
    "Voice-triggered multi-agent workflows",
  ];

  return (
    <div style={{
      height: "100%", display: "grid",
      gridTemplateColumns: "1fr 340px",
      gap: 0, overflow: "hidden",
      background: "var(--color-bg)",
    }}>

      {/* ── Left: scrollable status ─────────────────────────────────────── */}
      <div style={{ overflowY: "auto", padding: "20px 24px" }}>

        <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>
          Sir Jazper OS — Platform Roadmap
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: 12, opacity: 0.45 }}>
          Live overview of what&apos;s built, what&apos;s next, and what&apos;s planned.
        </p>

        {/* Stats bar */}
        {stats && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            <StatItem label="Agents"    value={stats.agents} />
            <StatItem label="Panels"    value={stats.panels} />
            <StatItem label="API Routes" value={stats.api_routes} />
            <StatItem label="Workers"   value={stats.workers} />
            <StatItem label="Tests"     value={stats.tests} />
            <StatItem label="Memories"  value={stats.memories_total} />
            <StatItem label="Sessions"  value={stats.chat_sessions} />
            <StatItem label="Jobs Applied" value={stats.job_applications} />
            {stats.unresolved_errors > 0 && (
              <StatItem label="Errors" value={stats.unresolved_errors} />
            )}
          </div>
        )}
        {loading && (
          <p style={{ fontSize: 11, opacity: 0.4, marginBottom: 18 }}>Loading platform state…</p>
        )}

        {/* Phases */}
        <Section title="Build Phases" count={phases.length} defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {phases.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusBadge status={p.status} />
                <span style={{ fontSize: 12, opacity: p.status === "done" ? 0.6 : 1 }}>{p.name}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Features */}
        <Section title="Features" count={features.length} defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {features.map(f => (
              <div key={f.name} style={{
                padding: "9px 12px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{f.name}</span>
                  <StatusBadge status={f.status} />
                </div>
                <p style={{ margin: 0, fontSize: 11, opacity: 0.55, lineHeight: 1.5 }}>{f.description}</p>
                {f.agents.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {f.agents.map(a => (
                      <span key={a} style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 3,
                        background: "var(--color-bg)", border: "1px solid var(--color-border)",
                        opacity: 0.7,
                      }}>{a}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* Agents */}
        <Section title="Agents" count={agents.length} defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agents.map(a => (
              <div key={a.name} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "8px 12px",
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                borderRadius: 6,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{a.emoji}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{a.description}</div>
                  <div style={{ fontSize: 10, opacity: 0.35, marginTop: 3 }}>{a.model}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Next up */}
        <Section title="Next Up — Option A: Advanced Orchestration" defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nextItems.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: "var(--color-accent)", fontSize: 14, flexShrink: 0, lineHeight: 1.4 }}>○</span>
                <span style={{ fontSize: 12, opacity: 0.75 }}>{item}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Errors */}
        <Section title="Recent Issues" count={errors.length} defaultOpen={errors.length > 0}>
          {errors.length === 0 ? (
            <p style={{ fontSize: 11, opacity: 0.4, margin: 0 }}>No unresolved errors.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {errors.map((e, i) => (
                <div key={i} style={{
                  padding: "7px 10px", borderRadius: 5,
                  background: "#1a0a0a", border: "1px solid #3f1515",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#f87171" }}>{e.agent}</div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{e.error}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Upcoming */}
        <Section title="Upcoming — Options C & D" defaultOpen={false}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, marginBottom: 4 }}>Option C — IT Department (Self-Repair + Self-Create)</div>
              {["SentryWorker polls error_store every 30s", "Darwin + Oracle + Forge + Shield — repair workflow", "Scroll + Forge — Self-Create workflow", "Autonomous repairs for trivial/known patterns"].map((x, i) => (
                <div key={i} style={{ fontSize: 11, opacity: 0.55, padding: "2px 0" }}>○ {x}</div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, marginBottom: 4 }}>Option D — Phases Advanced</div>
              {["Voice per personality (different Edge-TTS voices)", "Psychological profiling (Big Five)", "Memory injection (Sage feeds past events)", "Personality timeline (simulate any year)"].map((x, i) => (
                <div key={i} style={{ fontSize: 11, opacity: 0.55, padding: "2px 0" }}>○ {x}</div>
              ))}
            </div>
          </div>
        </Section>

      </div>

      {/* ── Right: mini-chat (sticky) ───────────────────────────────────── */}
      <div style={{
        borderLeft: "1px solid var(--color-border)",
        padding: 16, display: "flex", flexDirection: "column",
        height: "100%", overflow: "hidden",
      }}>
        <MiniChat />
      </div>

    </div>
  );
}
