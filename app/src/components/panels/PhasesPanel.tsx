"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Brain, Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Save, BookOpen, Mic } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonalityProfile {
  id: string;
  name: string;
  emoji: string;
  phase: string;
  description: string;
  traits: string[];
  riskTolerance: number;
  logicLevel: number;
  emotionLevel: number;
  optimism: number;
}

interface Message {
  id: string;
  role: "user" | "personality";
  personalityId?: string;
  personalityName?: string;
  personalityEmoji?: string;
  content: string;
  ts: number;
}

type Mode = "roster" | "solo" | "group";

// Auto-play TTS for a completed personality message using configured voice
async function playPersonalityTTS(personalityId: string, text: string, apiBase: string) {
  if (!text.trim() || !personalityId) return;
  try {
    const r = await fetch(`${apiBase}/api/phases/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personality_id: personalityId, text: text.slice(0, 500) }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play().catch(() => {});
  } catch { /* TTS offline — silent */ }
}

// ── Fallback presets (shown when backend is offline) ─────────────────────────

const FALLBACK_PERSONALITIES: PersonalityProfile[] = [
  { id: "past-self",      name: "Past Self",      emoji: "⏪", phase: "2018–2021",        description: "The cautious, ambitious version finding their footing.",              traits: ["Cautious","Ambitious","Self-doubting","Eager"],     riskTolerance: 0.25, logicLevel: 0.50, emotionLevel: 0.75, optimism: 0.45 },
  { id: "current-self",   name: "Current Self",   emoji: "🎯", phase: "Now",               description: "Seasoned by experience, pragmatic about what's possible.",           traits: ["Pragmatic","Experienced","Balanced","Growth-focused"], riskTolerance: 0.55, logicLevel: 0.70, emotionLevel: 0.55, optimism: 0.65 },
  { id: "future-self",    name: "Future Self",    emoji: "🚀", phase: "5–10 years ahead",  description: "Confident, strategic — has navigated the risks you're weighing.",    traits: ["Confident","Strategic","Decisive","Long-horizon"],  riskTolerance: 0.80, logicLevel: 0.80, emotionLevel: 0.40, optimism: 0.85 },
  { id: "logical-self",   name: "Logical Self",   emoji: "🧮", phase: "Rational mode",     description: "Pure analysis — strips emotion, focuses on data and probabilities.", traits: ["Analytical","Precise","Evidence-driven","Neutral"],  riskTolerance: 0.50, logicLevel: 0.95, emotionLevel: 0.10, optimism: 0.50 },
  { id: "emotional-self", name: "Emotional Self", emoji: "❤️", phase: "Feeling mode",      description: "Your gut — values, identity, and what you'd regret.",                traits: ["Empathetic","Intuitive","Values-driven","Relational"], riskTolerance: 0.40, logicLevel: 0.20, emotionLevel: 0.95, optimism: 0.60 },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function TraitBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: 3 }}>
      <span className="sj-micro" style={{ color: "var(--color-text-muted)", width: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--color-surface-float)", overflow: "hidden" }}>
        <div style={{ width: `${value * 100}%`, height: "100%", borderRadius: 2, background: "var(--color-accent)" }} />
      </div>
      <span className="sj-mono" style={{ fontSize: 9, color: "var(--color-text-muted)", width: 24, textAlign: "right" }}>{Math.round(value * 100)}</span>
    </div>
  );
}

function PersonalityCard({ p, selected, onClick, onRemove }: {
  p: PersonalityProfile;
  selected: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        background: selected ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-raised))" : "var(--color-surface-raised)",
        border: selected ? "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)" : "var(--border)",
        borderRadius: "var(--r-md)", overflow: "hidden", cursor: "pointer", transition: "var(--ease-soft)",
      }}
      onClick={onClick}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-3)" }}>
        <span style={{ fontSize: 20 }}>{p.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sj-label" style={{ fontSize: 12 }}>{p.name}</div>
          <div className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{p.phase}</div>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-1)" }}>
          {onRemove && (
            <button onClick={e => { e.stopPropagation(); onRemove(); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 2 }}>
              <Trash2 size={11} />
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 2 }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: "var(--border)", padding: "var(--sp-3)" }}>
          <p style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: "var(--sp-2)" }}>{p.description}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginBottom: "var(--sp-2)" }}>
            {p.traits.map(t => (
              <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "color-mix(in srgb, var(--color-accent) 10%, transparent)", color: "var(--color-accent)", border: "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)" }}>{t}</span>
            ))}
          </div>
          <TraitBar label="Risk Tolerance" value={p.riskTolerance} />
          <TraitBar label="Logic"          value={p.logicLevel} />
          <TraitBar label="Emotion"        value={p.emotionLevel} />
          <TraitBar label="Optimism"       value={p.optimism} />
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--sp-3)" }}>
        <div style={{ maxWidth: "70%", padding: "var(--sp-2) var(--sp-3)", background: "var(--color-accent)", borderRadius: "var(--r-md) var(--r-md) 2px var(--r-md)", fontSize: 12, color: "#fff", lineHeight: 1.6 }}>
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-3)", alignItems: "flex-start" }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{msg.personalityEmoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sj-micro" style={{ color: "var(--color-text-muted)", marginBottom: 3 }}>{msg.personalityName}</div>
        <div style={{ padding: "var(--sp-2) var(--sp-3)", background: "var(--color-surface-raised)", border: "var(--border)", borderRadius: "2px var(--r-md) var(--r-md) var(--r-md)", fontSize: 12, lineHeight: 1.7 }}>
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ── Chat hook — handles SSE streaming from phases backend ─────────────────────

function usePhasesSend(
  mode: Mode,
  selectedId: string,
  groupActive: Set<string>,
  personalities: PersonalityProfile[],
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  voiceEnabled: boolean,
) {
  const [thinking, setThinking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Track last completed message per personality for TTS
  const completedRef = useRef<Record<string, string>>({});

  const send = useCallback(async (text: string) => {
    if (!text.trim() || thinking) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text.trim(), ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const history = messages.slice(-10).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    const endpoint = mode === "solo" ? `${API}/api/phases/chat` : `${API}/api/phases/group-chat`;
    const body = mode === "solo"
      ? { personality_id: selectedId, message: text.trim(), history }
      : {
          personality_ids: personalities.filter(p => groupActive.has(p.id)).map(p => p.id),
          message: text.trim(),
          history,
        };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Current streaming personality state
      let currentId = "";
      let currentName = "";
      let currentEmoji = "";
      let currentMsgId = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;

          try {
            const evt = JSON.parse(raw);

            if (evt.type === "personality_start") {
              currentId    = evt.id;
              currentName  = evt.name;
              currentEmoji = evt.emoji;
              currentMsgId = `${Date.now()}-${evt.id}`;
              setMessages(prev => [...prev, {
                id: currentMsgId, role: "personality",
                personalityId: currentId, personalityName: currentName,
                personalityEmoji: currentEmoji, content: "", ts: Date.now(),
              }]);
            } else if (evt.type === "token" && currentMsgId) {
              setMessages(prev => prev.map(m =>
                m.id === currentMsgId ? { ...m, content: m.content + evt.text } : m
              ));
            } else if (evt.type === "personality_done") {
              if (voiceEnabled && currentMsgId) {
                const captured = currentMsgId;
                const capturedId = currentId;
                setMessages(prev => {
                  const msg = prev.find(m => m.id === captured);
                  if (msg?.content) playPersonalityTTS(capturedId, msg.content, API);
                  return prev;
                });
              }
              currentMsgId = "";
            }
          } catch { /* non-JSON line */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setMessages(prev => [...prev, {
          id: Date.now().toString(), role: "personality",
          personalityId: "error", personalityName: "Error", personalityEmoji: "⚠️",
          content: `Backend error: ${err instanceof Error ? err.message : String(err)}`, ts: Date.now(),
        }]);
      }
    } finally {
      setThinking(false);
    }
  }, [thinking, messages, mode, selectedId, groupActive, personalities, setMessages]);

  return { thinking, send };
}

// ── Saved sessions list ───────────────────────────────────────────────────────

function SavedSessionsList({ onLoad, onClose }: {
  onLoad: (messages: Message[]) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<{ id: string; title: string; mode: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/phases/sessions`)
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function load(id: string) {
    const res = await fetch(`${API}/api/phases/sessions/${id}`);
    const data = await res.json();
    if (data.messages) {
      const msgs: Message[] = data.messages.map((m: Record<string, unknown>) => ({
        id: `loaded-${Math.random()}`,
        role: m.role as "user" | "personality",
        personalityId: m.personalityId as string | undefined,
        personalityName: m.personalityName as string | undefined,
        personalityEmoji: m.personalityEmoji as string | undefined,
        content: m.content as string,
        ts: m.ts as number,
      }));
      onLoad(msgs);
    }
  }

  async function del(id: string) {
    await fetch(`${API}/api/phases/sessions/${id}`, { method: "DELETE" });
    setSessions(prev => prev.filter(s => s.id !== id));
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "var(--color-surface)", zIndex: 10, display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <BookOpen size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Saved Sessions</span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: 11 }}>← Back</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {loading && <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>Loading...</p>}
        {!loading && sessions.length === 0 && <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>No saved sessions yet.</p>}
        {sessions.map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-3)", background: "var(--color-surface-raised)", border: "var(--border)", borderRadius: "var(--r-md)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sj-label" style={{ fontSize: 11 }}>{s.title}</div>
              <div className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{s.mode} · {new Date(s.created_at).toLocaleDateString()}</div>
            </div>
            <button onClick={() => load(s.id)} style={{ background: "none", border: "var(--border)", borderRadius: "var(--r-xs)", cursor: "pointer", padding: "2px 8px", fontSize: 10, color: "var(--color-text-secondary)" }}>Load</button>
            <button onClick={() => del(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function PhasesPanel({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [allPersonalities, setAllPersonalities] = useState<PersonalityProfile[]>(FALLBACK_PERSONALITIES);
  const [active, setActive] = useState<PersonalityProfile[]>(FALLBACK_PERSONALITIES.slice(0, 3));
  const [selectedId, setSelectedId] = useState(FALLBACK_PERSONALITIES[1].id);
  const [mode, setMode] = useState<Mode>("roster");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [groupActive, setGroupActive] = useState<Set<string>>(new Set(FALLBACK_PERSONALITIES.slice(0, 3).map(p => p.id)));
  const [saveEnabled, setSaveEnabled] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load personalities from backend
  useEffect(() => {
    fetch(`${API}/api/phases/personalities`)
      .then(r => r.json())
      .then(d => {
        if (d.personalities?.length) {
          setAllPersonalities(d.personalities);
          setActive(d.personalities.slice(0, 3));
          setSelectedId(d.personalities[1]?.id ?? d.personalities[0].id);
          setGroupActive(new Set(d.personalities.slice(0, 3).map((p: PersonalityProfile) => p.id)));
        }
      })
      .catch(() => { /* keep fallbacks */ });
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { thinking, send } = usePhasesSend(mode, selectedId, groupActive, active, messages, setMessages, voiceEnabled);

  function handleSend() {
    send(input);
    setInput("");
  }

  async function saveSession() {
    if (messages.length === 0) return;
    setSaving(true);
    const personalityIds = mode === "solo" ? [selectedId] : [...groupActive];
    const title = `${mode === "solo" ? (active.find(p => p.id === selectedId)?.name ?? "Solo") : "Group"} — ${new Date().toLocaleDateString()}`;
    try {
      await fetch(`${API}/api/phases/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, mode, personality_ids: personalityIds, messages }),
      });
    } catch { /* silent */ }
    setSaving(false);
  }

  function addPersonality(p: PersonalityProfile) {
    if (!active.find(a => a.id === p.id)) {
      setActive(prev => [...prev, p]);
      setGroupActive(prev => new Set([...prev, p.id]));
    }
  }

  function removePersonality(id: string) {
    setActive(prev => prev.filter(p => p.id !== id));
    setGroupActive(prev => { const s = new Set(prev); s.delete(id); return s; });
    if (selectedId === id) setSelectedId(active[0]?.id ?? "");
  }

  function toggleGroup(id: string) {
    setGroupActive(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  const available = allPersonalities.filter(p => !active.find(a => a.id === p.id));
  const selectedP = active.find(p => p.id === selectedId) ?? active[0];
  const isChatMode = mode === "solo" || mode === "group";

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {showSaved && (
        <SavedSessionsList
          onLoad={msgs => { setMessages(msgs); setShowSaved(false); }}
          onClose={() => setShowSaved(false)}
        />
      )}

      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <Brain size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Phases</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-1)", alignItems: "center" }}>
          {/* Save toggle */}
          {isChatMode && (
            <>
              <button
                onClick={() => setSaveEnabled(v => !v)}
                title={saveEnabled ? "Auto-save on (click to disable)" : "Auto-save off"}
                style={{
                  display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                  padding: "2px 7px", borderRadius: "var(--r-xs)", border: "var(--border)",
                  cursor: "pointer", background: saveEnabled ? "color-mix(in srgb, var(--color-accent) 15%, transparent)" : "var(--color-surface-float)",
                  color: saveEnabled ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                <Save size={10} />
                {saveEnabled ? "Saving" : "Save off"}
              </button>
              {messages.length > 0 && saveEnabled && (
                <button onClick={saveSession} disabled={saving}
                  style={{ fontSize: 10, padding: "2px 7px", borderRadius: "var(--r-xs)", border: "var(--border)", cursor: "pointer", background: "var(--color-surface-float)", color: "var(--color-text-muted)", opacity: saving ? 0.5 : 1 }}>
                  {saving ? "Saving..." : "Save now"}
                </button>
              )}
              <button onClick={() => setShowSaved(true)} title="Saved sessions"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                <BookOpen size={12} />
              </button>
            </>
          )}
          {/* Voice toggle + setup */}
          {isChatMode && (
            <>
              <button
                onClick={() => setVoiceEnabled(v => !v)}
                title={voiceEnabled ? "Voice auto-play on (click to mute)" : "Voice auto-play off"}
                style={{
                  display: "flex", alignItems: "center", gap: 4, fontSize: 10,
                  padding: "2px 7px", borderRadius: "var(--r-xs)", border: "var(--border)",
                  cursor: "pointer",
                  background: voiceEnabled ? "color-mix(in srgb, var(--color-accent) 15%, transparent)" : "var(--color-surface-float)",
                  color: voiceEnabled ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                <Mic size={10} />
                {voiceEnabled ? "Voice on" : "Voice off"}
              </button>
              {onNavigate && (
                <button
                  onClick={() => onNavigate("voice_profile")}
                  title="Voice & Personality Profile setup"
                  style={{ background: "none", border: "var(--border)", borderRadius: "var(--r-xs)", cursor: "pointer", padding: "2px 6px", color: "var(--color-text-muted)", display: "flex", fontSize: 10 }}
                >
                  Setup
                </button>
              )}
            </>
          )}
          {/* Mode tabs */}
          {(["roster", "solo", "group"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: "var(--r-xs)", border: "var(--border)", cursor: "pointer",
              background: mode === m ? "var(--color-accent)" : "var(--color-surface-float)",
              color: mode === m ? "#fff" : "var(--color-text-muted)", fontWeight: mode === m ? 600 : 400,
            }}>
              {m === "roster" ? "Roster" : m === "solo" ? "Solo" : "Group"}
            </button>
          ))}
        </div>
      </div>

      {/* ── ROSTER ──────────────────────────────────────────────────────── */}
      {mode === "roster" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <div style={{ padding: "var(--sp-3)", borderRadius: "var(--r-md)", background: "color-mix(in srgb, var(--color-accent) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-1)" }}>
              <Sparkles size={11} style={{ color: "var(--color-accent)" }} />
              <span className="sj-label" style={{ fontSize: 11 }}>Digital Mind Simulation</span>
            </div>
            <p className="sj-micro" style={{ color: "var(--color-text-muted)", lineHeight: 1.6 }}>
              Different versions of you responding to the same question.
              Use <strong>Solo</strong> for a private conversation with one personality.
              Use <strong>Group</strong> to let all of them debate a decision together.
            </p>
          </div>

          <span className="sj-label" style={{ fontSize: 11 }}>Active ({active.length})</span>
          {active.map(p => (
            <PersonalityCard key={p.id} p={p} selected={selectedId === p.id} onClick={() => setSelectedId(p.id)}
              onRemove={active.length > 1 ? () => removePersonality(p.id) : undefined} />
          ))}

          {available.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
                <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>Add personality</span>
                <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
              </div>
              {available.map(p => (
                <button key={p.id} onClick={() => addPersonality(p)} style={{
                  display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-3)",
                  borderRadius: "var(--r-md)", background: "var(--color-surface-raised)", border: "1px dashed var(--color-border)",
                  cursor: "pointer", width: "100%", textAlign: "left", opacity: 0.7,
                }}>
                  <span style={{ fontSize: 18 }}>{p.emoji}</span>
                  <div>
                    <div className="sj-label" style={{ fontSize: 11 }}>{p.name}</div>
                    <div className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{p.phase}</div>
                  </div>
                  <Plus size={11} style={{ marginLeft: "auto", color: "var(--color-text-muted)" }} />
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── SOLO CHAT ───────────────────────────────────────────────────── */}
      {mode === "solo" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Personality picker */}
          <div style={{ display: "flex", gap: "var(--sp-2)", padding: "var(--sp-3) var(--sp-4)", borderBottom: "var(--border)", overflowX: "auto", flexShrink: 0 }}>
            {active.map(p => (
              <button key={p.id} onClick={() => { setSelectedId(p.id); setMessages([]); }} style={{
                display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-2) var(--sp-3)",
                borderRadius: "var(--r-sm)", border: selectedId === p.id ? "1px solid var(--color-accent)" : "var(--border)",
                background: selectedId === p.id ? "color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-raised))" : "var(--color-surface-raised)",
                cursor: "pointer", flexShrink: 0,
              }}>
                <span style={{ fontSize: 14 }}>{p.emoji}</span>
                <span className="sj-label" style={{ fontSize: 10 }}>{p.name}</span>
              </button>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4)" }}>
            {messages.filter(m => m.role === "user" || m.personalityId === selectedId).length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: 40 }}>
                <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>{selectedP?.emoji}</div>
                <div className="sj-label" style={{ marginBottom: "var(--sp-2)" }}>{selectedP?.name}</div>
                <p className="sj-micro" style={{ color: "var(--color-text-muted)", maxWidth: 280, margin: "0 auto 12px", lineHeight: 1.7 }}>{selectedP?.description}</p>
                <p className="sj-micro" style={{ color: "var(--color-text-muted)" }}>Ask anything — decisions, career, life choices...</p>
              </div>
            ) : (
              messages
                .filter(m => m.role === "user" || m.personalityId === selectedId)
                .map(m => <ChatBubble key={m.id} msg={m} />)
            )}
            {thinking && (
              <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", marginBottom: "var(--sp-3)" }}>
                <span style={{ fontSize: 16 }}>{selectedP?.emoji}</span>
                <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "var(--sp-3) var(--sp-4)", borderTop: "var(--border)", display: "flex", gap: "var(--sp-2)", flexShrink: 0 }}>
            <input className="sj-input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={`Ask ${selectedP?.name ?? "your personality"}...`} style={{ flex: 1, fontSize: 12 }} />
            <button onClick={handleSend} disabled={!input.trim() || thinking} style={{
              padding: "0 var(--sp-4)", borderRadius: "var(--r-sm)", background: "var(--color-accent)",
              border: "none", cursor: "pointer", color: "#fff", fontSize: 11, fontWeight: 600,
              opacity: (!input.trim() || thinking) ? 0.5 : 1,
            }}>Send</button>
          </div>
        </div>
      )}

      {/* ── GROUP CHAT ──────────────────────────────────────────────────── */}
      {mode === "group" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Member toggles */}
          <div style={{ display: "flex", gap: "var(--sp-2)", padding: "var(--sp-3) var(--sp-4)", borderBottom: "var(--border)", overflowX: "auto", flexShrink: 0, alignItems: "center" }}>
            <span className="sj-micro" style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>In room:</span>
            {active.map(p => (
              <button key={p.id} onClick={() => toggleGroup(p.id)} style={{
                display: "flex", alignItems: "center", gap: "var(--sp-1)", padding: "var(--sp-1) var(--sp-2)",
                borderRadius: "var(--r-sm)", border: groupActive.has(p.id) ? "1px solid var(--color-accent)" : "var(--border)",
                background: groupActive.has(p.id) ? "color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-raised))" : "var(--color-surface-raised)",
                cursor: "pointer", flexShrink: 0, opacity: groupActive.has(p.id) ? 1 : 0.45,
              }}>
                <span style={{ fontSize: 12 }}>{p.emoji}</span>
                <span className="sj-micro">{p.name}</span>
              </button>
            ))}
            <button onClick={() => setMessages([])} style={{ marginLeft: "auto", background: "none", border: "var(--border)", borderRadius: "var(--r-xs)", cursor: "pointer", padding: "var(--sp-1) var(--sp-2)", color: "var(--color-text-muted)", fontSize: 10, flexShrink: 0 }}>Clear</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4)" }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: "var(--sp-3)" }}>{active.filter(p => groupActive.has(p.id)).map(p => p.emoji).join(" ")}</div>
                <p className="sj-micro" style={{ color: "var(--color-text-muted)", maxWidth: 300, margin: "0 auto", lineHeight: 1.7 }}>
                  All selected personalities respond to the same question.<br />
                  Try: <em>"Should I quit my job to start a company?"</em>
                </p>
              </div>
            ) : (
              messages.map(m => <ChatBubble key={m.id} msg={m} />)
            )}
            {thinking && (
              <div className="sj-micro" style={{ color: "var(--color-text-muted)", marginBottom: "var(--sp-2)" }}>
                {active.filter(p => groupActive.has(p.id)).map(p => p.emoji).join(" ")} thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "var(--sp-3) var(--sp-4)", borderTop: "var(--border)", display: "flex", gap: "var(--sp-2)", flexShrink: 0 }}>
            <input className="sj-input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask all your selves..." style={{ flex: 1, fontSize: 12 }} />
            <button onClick={handleSend} disabled={!input.trim() || thinking || groupActive.size === 0} style={{
              padding: "0 var(--sp-4)", borderRadius: "var(--r-sm)", background: "var(--color-accent)",
              border: "none", cursor: "pointer", color: "#fff", fontSize: 11, fontWeight: 600,
              opacity: (!input.trim() || thinking || groupActive.size === 0) ? 0.5 : 1,
            }}>Ask All</button>
          </div>
        </div>
      )}
    </div>
  );
}
