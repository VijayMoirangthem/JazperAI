"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, MessageSquare, Copy, Check, SquarePen, Globe, Mic, MicOff, Volume2, VolumeX, Radio, Zap, Paperclip, Camera, X, Clock, Ghost, Save, Play, Square, Brain, ChevronDown, ChevronRight, Search, Mail, Database, Eye, Cpu } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useSession } from "@/hooks/useSession";
import { useVAD } from "@/hooks/useVAD";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Minimal WAV encoder (browser-side, no ffmpeg needed) ─────────────────────
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const write = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  const mono = decoded.getChannelData(0); // take left channel
  await ctx.close();
  return encodeWav(mono, 16000);
}

type Role = "user" | "assistant";

interface TokenUsage { prompt: number; completion: number; total: number; }

interface AgentToolCall { tool: string; input: Record<string, unknown>; output_preview: string; duration_ms: number; }
interface AgentTraceData {
  agent: string;
  task: string;
  model: string;
  tool_calls: AgentToolCall[];
  tokens_total: number;
  duration_ms: number;
  success: boolean;
  error?: string;
}
interface MessageMeta { model: string; duration_ms: number; tokens: TokenUsage; agent_traces?: AgentTraceData[]; }

interface ActiveAgent { name: string; emoji: string; task: string; }

interface ChainStep {
  step: number;
  status: "thinking" | "running" | "done" | "error" | "approved" | "cancelled" | "timeout";
  label?: string;
  result?: string;
}

interface PendingApproval {
  step: number;
  tool: string;
  description: string;
  preview?: string;
  args: Record<string, unknown>;
  aiId: string;
}

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  meta?: MessageMeta;
  streaming?: boolean;
  image?: string;
  thinking?: string;
  planCreated?: { plan_id: string; title: string; agent: string };
  darwinTriggered?: { mode: "repair" | "create"; error_id?: string; description?: string };
  chainPlan?: { steps: string[] };
  chainSteps?: ChainStep[];
  chainError?: string;
}

// ── Agent emoji map ───────────────────────────────────────────────────────────
const AGENT_EMOJI: Record<string, string> = {
  Scout: "🔍", Hermes: "📧", Sage: "🧠", Lens: "📷", Atlas: "📋", Phantom: "👻",
};
const AGENT_ICON: Record<string, React.ReactNode> = {
  Scout: <Search size={9} />, Hermes: <Mail size={9} />,
  Sage: <Database size={9} />, Lens: <Eye size={9} />,
  Atlas: <Cpu size={9} />, Phantom: <Globe size={9} />,
};

function fmt(ms: number) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function Tooltip({ meta, timestamp }: { meta: MessageMeta; timestamp: number }) {
  return (
    <div style={{
      position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 50,
      background: "var(--color-surface-raised)", border: "var(--border-hi)",
      borderRadius: "var(--r-md)", padding: "var(--sp-3)", minWidth: 220,
      pointerEvents: "none", animation: "sj-fade-in 0.12s ease forwards",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
        <span className="sj-dot sj-dot-settled" />
        <span className="sj-label">Response Metadata</span>
      </div>
      {[
        { label: "Model",             value: meta.model },
        { label: "Response Time",     value: fmt(meta.duration_ms), hi: true },
        { label: "Completion Tokens", value: meta.tokens.completion.toLocaleString(), hi: true },
        { label: "Total Tokens",      value: meta.tokens.total.toLocaleString() },
        { label: "Timestamp",         value: fmtTime(timestamp) },
        { label: "Speed",             value: meta.duration_ms > 0 ? `${Math.round(meta.tokens.completion / (meta.duration_ms / 1000))} tok/s` : "—" },
      ].map(({ label, value, hi }) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "var(--border-lo)" }}>
          <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{label}</span>
          <span className="sj-mono" style={{ fontSize: 11, color: hi ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: hi ? 500 : 400 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function AgentTraceBadges({ traces }: { traces: AgentTraceData[] }) {
  const [open, setOpen] = useState(false);
  if (!traces.length) return null;

  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      {/* Agent badges row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {traces.map(t => (
          <span key={t.agent} style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            fontSize: 10, padding: "2px 6px", borderRadius: "var(--r-xs)",
            background: t.success
              ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
              : "color-mix(in srgb, #ef4444 10%, transparent)",
            border: `1px solid ${t.success ? "color-mix(in srgb, var(--color-accent) 25%, transparent)" : "color-mix(in srgb, #ef4444 25%, transparent)"}`,
            color: t.success ? "var(--color-accent)" : "#ef4444",
          }}>
            {AGENT_EMOJI[t.agent] || "🤖"} {t.agent}
            <span style={{ opacity: 0.6 }}>·</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
              {t.duration_ms < 1000 ? `${t.duration_ms}ms` : `${(t.duration_ms/1000).toFixed(1)}s`}
            </span>
          </span>
        ))}
        <button onClick={() => setOpen(v => !v)} style={{
          background: "none", border: "none", cursor: "pointer", padding: "1px 4px",
          color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 2, fontSize: 10,
          borderRadius: "var(--r-xs)",
        }}>
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {open ? "Hide trace" : "Trace"}
        </button>
      </div>

      {/* Trace drawer */}
      {open && (
        <div style={{
          marginTop: "var(--sp-2)", borderRadius: "var(--r-md)",
          border: "var(--border-hi)", overflow: "hidden",
          background: "var(--color-surface)",
        }}>
          {/* Header */}
          <div style={{
            padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)",
            display: "flex", alignItems: "center", gap: "var(--sp-2)",
            background: "var(--color-surface-raised)",
          }}>
            <span className="sj-label" style={{ fontSize: 10 }}>AGENT TRACE</span>
            <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>
              {traces.length} agent{traces.length > 1 ? "s" : ""} ·{" "}
              {traces.reduce((s, t) => s + t.tokens_total, 0).toLocaleString()} tokens
            </span>
          </div>

          {traces.map((t, ti) => (
            <div key={ti} style={{ borderBottom: ti < traces.length - 1 ? "var(--border)" : "none" }}>
              {/* Agent header */}
              <div style={{
                padding: "var(--sp-2) var(--sp-3)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "color-mix(in srgb, var(--color-accent) 4%, transparent)",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {AGENT_EMOJI[t.agent] || "🤖"} {t.agent}
                  <span className="sj-micro" style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
                    {t.model.split("/").pop()}
                  </span>
                </span>
                <span className="sj-mono" style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                  {t.duration_ms < 1000 ? `${t.duration_ms}ms` : `${(t.duration_ms/1000).toFixed(1)}s`}
                  {" · "}{t.tokens_total} tok
                </span>
              </div>

              {/* Task */}
              <div style={{ padding: "var(--sp-2) var(--sp-3)", borderBottom: t.tool_calls.length ? "var(--border-lo)" : "none" }}>
                <div className="sj-micro" style={{ color: "var(--color-text-muted)", marginBottom: 2 }}>TASK</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontStyle: "italic" }}>{t.task}</div>
              </div>

              {/* Tool calls */}
              {t.tool_calls.map((tc, tci) => (
                <div key={tci} style={{
                  padding: "var(--sp-2) var(--sp-3)",
                  borderBottom: tci < t.tool_calls.length - 1 ? "var(--border-lo)" : "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10,
                      padding: "1px 6px", borderRadius: "var(--r-xs)",
                      background: "color-mix(in srgb, var(--color-text-muted) 10%, transparent)",
                      color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)",
                    }}>
                      {tc.tool}
                    </span>
                    <span className="sj-mono" style={{ fontSize: 9, color: "var(--color-text-muted)" }}>
                      {tc.duration_ms}ms
                    </span>
                  </div>
                  {tc.output_preview && (
                    <div style={{
                      fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)",
                      background: "var(--color-surface-raised)", borderRadius: "var(--r-xs)",
                      padding: "4px 6px", maxHeight: 80, overflow: "hidden",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {tc.output_preview}
                    </div>
                  )}
                </div>
              ))}

              {/* Error */}
              {t.error && (
                <div style={{ padding: "var(--sp-2) var(--sp-3)", color: "#ef4444", fontSize: 11 }}>
                  ⚠ {t.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STEP_ICONS: Record<string, string> = {
  thinking: "⋯", running: "⟳", done: "✓", error: "✕",
  approved: "✓", cancelled: "—", timeout: "⏱",
};
const STEP_COLORS: Record<string, string> = {
  thinking: "var(--color-text-muted)",
  running:  "var(--color-accent)",
  done:     "#22c55e",
  error:    "#ef4444",
  approved: "#22c55e",
  cancelled:"var(--color-text-muted)",
  timeout:  "#f97316",
};

function ChainPlanCard({ steps, chainSteps, chainError }: { steps: string[]; chainSteps?: ChainStep[]; chainError?: string }) {
  const [open, setOpen] = useState(true);
  const stepMap = useMemo(() => {
    const m: Record<number, ChainStep> = {};
    (chainSteps || []).forEach(s => { m[s.step] = s; });
    return m;
  }, [chainSteps]);

  return (
    <div style={{
      marginTop: "var(--sp-2)", borderRadius: "var(--r-md)",
      border: "1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)",
      background: "color-mix(in srgb, var(--color-accent) 4%, transparent)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "var(--sp-2) var(--sp-3)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          color: "var(--color-text-primary)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600 }}>
          <Zap size={11} style={{ color: "var(--color-accent)" }} />
          Agentic Chain
        </span>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>

      {open && (
        <div style={{ borderTop: "1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)" }}>
          {steps.map((stepText, i) => {
            const n = i + 1;
            const cs = stepMap[n];
            const status = cs?.status || (chainError ? "error" : "thinking");
            const color = STEP_COLORS[status] || "var(--color-text-muted)";
            const icon = STEP_ICONS[status] || "·";
            return (
              <div key={i} style={{
                padding: "5px var(--sp-3)",
                display: "flex", alignItems: "flex-start", gap: 8,
                borderBottom: i < steps.length - 1
                  ? "1px solid color-mix(in srgb, var(--color-accent) 8%, transparent)"
                  : "none",
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color,
                  minWidth: 14, textAlign: "center", marginTop: 1,
                  fontFamily: "var(--font-mono)",
                }}>
                  {icon}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                    {stepText}
                  </div>
                  {cs?.label && cs.status !== "thinking" && (
                    <div style={{
                      fontSize: 10, color: "var(--color-text-muted)",
                      fontFamily: "var(--font-mono)", marginTop: 1,
                    }}>
                      {cs.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {chainError && (
            <div style={{
              padding: "6px var(--sp-3)",
              borderTop: "1px solid color-mix(in srgb, #ef4444 20%, transparent)",
              background: "color-mix(in srgb, #ef4444 6%, transparent)",
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 10, color: "#ef4444",
              fontFamily: "var(--font-mono)",
            }}>
              <span>✕</span>
              <span>{chainError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalModal({ approval, sessionId, onDone }: {
  approval: PendingApproval;
  sessionId: string | null;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  async function decide(action: "approve" | "cancel") {
    setLoading(true);
    try {
      await fetch(`${api}/api/chat/approve/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch { /* ignore — chain loop will timeout */ }
    setLoading(false);
    onDone();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--color-surface-raised)",
        border: "var(--border-hi)",
        borderRadius: "var(--r-lg)", padding: "var(--sp-5)",
        maxWidth: 480, width: "90%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        animation: "sj-fade-in 0.15s ease forwards",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--sp-3)" }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
            Approval Required
          </span>
        </div>
        <div style={{
          fontSize: 11, color: "var(--color-text-muted)",
          marginBottom: "var(--sp-2)", fontFamily: "var(--font-mono)",
          padding: "3px 8px", background: "var(--color-surface)",
          borderRadius: "var(--r-xs)", display: "inline-block",
        }}>
          {approval.tool}
        </div>
        <div style={{
          fontSize: 12, color: "var(--color-text-secondary)",
          marginBottom: "var(--sp-3)", whiteSpace: "pre-wrap", lineHeight: 1.5,
        }}>
          {approval.description}
        </div>
        {approval.preview && (
          <div style={{
            fontSize: 11, color: "var(--color-text-muted)",
            background: "var(--color-surface)", borderRadius: "var(--r-md)",
            padding: "var(--sp-2) var(--sp-3)", marginBottom: "var(--sp-3)",
            maxHeight: 120, overflow: "auto", fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            borderLeft: "2px solid var(--color-accent)",
          }}>
            {approval.preview}
          </div>
        )}
        <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
          <button
            onClick={() => decide("cancel")}
            disabled={loading}
            style={{
              padding: "6px 16px", borderRadius: "var(--r-md)", cursor: "pointer",
              border: "var(--border-hi)", background: "var(--color-surface)",
              color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => decide("approve")}
            disabled={loading}
            style={{
              padding: "6px 16px", borderRadius: "var(--r-md)", cursor: "pointer",
              border: "none", background: "var(--color-accent)",
              color: "#000", fontSize: 12, fontWeight: 600,
            }}
          >
            {loading ? "…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AIMessage({ msg, ttsVoice, hadImage }: { msg: Message; ttsVoice: string; hadImage?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function copy() {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function speak() {
    if (speaking) {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = "";
      setSpeaking(false);
      return;
    }
    try {
      setSpeaking(true);
      const res = await fetch(`${API}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.content, voice: ttsVoice }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  return (
    <div className="sj-chat-message sj-fade-in">
      <div className="sj-chat-avatar sj-chat-avatar-ai">AI</div>
      <div style={{ flex: 1, position: "relative" }}>
        {hovered && msg.meta && <Tooltip meta={msg.meta} timestamp={msg.timestamp} />}

        {msg.thinking && (
          <div style={{ marginBottom: "var(--sp-2)" }}>
            <button
              onClick={() => setShowThinking(v => !v)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "2px 6px",
                display: "flex", alignItems: "center", gap: 4,
                color: showThinking ? "var(--color-accent)" : "var(--color-text-muted)",
                fontSize: 10, borderRadius: "var(--r-xs)", transition: "var(--ease-snap)",
              }}
              title={showThinking ? "Hide thinking" : "Show thinking"}
            >
              <Brain size={10} /> {showThinking ? "Hide thinking" : "Show thinking"}
            </button>
            {showThinking && (
              <div style={{
                marginTop: "var(--sp-1)", padding: "var(--sp-2) var(--sp-3)",
                background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)",
                borderRadius: "var(--r-md)", fontSize: 11, color: "var(--color-text-muted)",
                whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5,
              }}>
                {msg.thinking}
              </div>
            )}
          </div>
        )}

        <div
          className="sj-chat-bubble"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", cursor: "default" }}
        >
          {msg.content}
          {msg.streaming && (
            <span style={{ display: "inline-flex", gap: 2, marginLeft: 4, verticalAlign: "middle" }}>
              <span className="sj-typing-dot" /><span className="sj-typing-dot" /><span className="sj-typing-dot" />
            </span>
          )}
        </div>

        {!msg.streaming && msg.meta?.agent_traces && msg.meta.agent_traces.length > 0 && (
          <AgentTraceBadges traces={msg.meta.agent_traces} />
        )}

        {msg.chainPlan && (
          <ChainPlanCard steps={msg.chainPlan.steps} chainSteps={msg.chainSteps} chainError={msg.chainError} />
        )}

        {msg.planCreated && (
          <button
            onClick={() => { window.location.hash = "plans"; }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "color-mix(in srgb, #22c55e 10%, transparent)",
              border: "1px solid color-mix(in srgb, #22c55e 25%, transparent)",
              borderRadius: 20, padding: "3px 11px", marginTop: "var(--sp-2)",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              color: "#22c55e", cursor: "pointer",
            }}
          >
            📋 Plan created: {msg.planCreated.title} — View Plans
          </button>
        )}

        {msg.darwinTriggered && (
          <button
            onClick={() => { window.location.hash = "it_dept"; }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "color-mix(in srgb, #f97316 10%, transparent)",
              border: "1px solid color-mix(in srgb, #f97316 25%, transparent)",
              borderRadius: 20, padding: "3px 11px", marginTop: "var(--sp-2)",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              color: "#f97316", cursor: "pointer",
            }}
          >
            🔧 Darwin {msg.darwinTriggered.mode === "repair" ? "diagnosing error" : "writing spec"} — View IT Dept
          </button>
        )}

        {!msg.streaming && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-1)", paddingLeft: "var(--sp-1)" }}>
            {hadImage && (
              <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--color-accent)", fontSize: 10 }}>
                <Camera size={9} /> Vision
              </span>
            )}
            {hadImage && <span style={{ color: "var(--color-border-hi)", fontSize: 10 }}>·</span>}
            {msg.meta && <>
              <span className="sj-micro">{fmt(msg.meta.duration_ms)}</span>
              <span style={{ color: "var(--color-border-hi)", fontSize: 10 }}>·</span>
              <span className="sj-micro">{msg.meta.tokens.total.toLocaleString()} tokens</span>
              <span style={{ color: "var(--color-border-hi)", fontSize: 10 }}>·</span>
            </>}
            <span className="sj-micro">{fmtTime(msg.timestamp)}</span>
            <button onClick={speak} title={speaking ? "Stop" : "Read aloud"} style={{
              background: "none", border: "none", cursor: "pointer",
              color: speaking ? "var(--color-accent)" : "var(--color-text-muted)",
              display: "flex", alignItems: "center",
              padding: "2px 4px", borderRadius: "var(--r-xs)", transition: "var(--ease-snap)",
            }}>
              {speaking ? <Square size={11} /> : <Play size={11} />}
            </button>
            <button onClick={copy} title="Copy" style={{
              marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
              color: "var(--color-text-muted)", display: "flex", alignItems: "center",
              padding: "2px 4px", borderRadius: "var(--r-xs)", transition: "var(--ease-snap)",
            }}>
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface LoadedSession {
  sessionId: string;
  messages: Array<{ role: string; content: string; created_at: string; meta?: { model?: string } }>;
}

interface ChatPanelProps {
  sessionToLoad?:    LoadedSession | null;
  onSessionLoaded?:  () => void;
  globalVoiceActive?: boolean;  // when true, suppress local wake word (global layer handles it)
}

function _endOfDay(d: Date): string {
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

function parseTaskNLP(raw: string): { title: string; priority: "low" | "medium" | "high"; due_at: string | null } {
  let title = raw;
  let priority: "low" | "medium" | "high" = "medium";
  let due_at: string | null = null;

  if (title.includes("!high")) { priority = "high"; title = title.replace("!high", ""); }
  else if (title.includes("!low")) { priority = "low"; title = title.replace("!low", ""); }

  const lower = title.toLowerCase();
  const now = new Date();

  if (/\btoday\b/.test(lower)) {
    due_at = _endOfDay(new Date());
    title = title.replace(/\btoday\b/i, "");
  } else if (/\btomorrow\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    due_at = _endOfDay(d);
    title = title.replace(/\btomorrow\b/i, "");
  } else if (/\bnext week\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() + 7);
    due_at = _endOfDay(d);
    title = title.replace(/\bnext week\b/i, "");
  } else {
    const inDays = lower.match(/\bin (\d+) days?\b/);
    if (inDays) {
      const d = new Date(); d.setDate(d.getDate() + parseInt(inDays[1]));
      due_at = _endOfDay(d);
      title = title.replace(/\bin \d+ days?\b/i, "");
    } else {
      const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
      for (let di = 0; di < DAYS.length; di++) {
        if (new RegExp(`\\b${DAYS[di]}\\b`).test(lower)) {
          const d = new Date();
          let diff = di - d.getDay();
          if (diff <= 0) diff += 7;
          d.setDate(d.getDate() + diff);
          due_at = _endOfDay(d);
          title = title.replace(new RegExp(`\\b${DAYS[di]}\\b`, "i"), "");
          break;
        }
      }
    }
  }

  void now; // suppress unused warning
  return { title: title.trim().replace(/\s{2,}/g, " "), priority, due_at };
}

export function ChatPanel({ sessionToLoad, onSessionLoaded, globalVoiceActive = false }: ChatPanelProps = {}) {
  const { settings } = useSettings();
  const { sessionId, newSession, switchSession } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  // Timeline mode
  const [timelineMode, setTimelineMode] = useState(false);
  const [timelineYear, setTimelineYear] = useState<number>(new Date().getFullYear() - 5);
  const [timelineYears, setTimelineYears] = useState<number[]>([]);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!timelineMode) return;
    fetch(`${API}/api/timeline/years`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.years?.length) setTimelineYears(d.years); })
      .catch(() => {});
  }, [timelineMode]);

  // Voice state
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [alwaysOnVoice, setAlwaysOnVoice] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [vadListening, setVadListening] = useState(false);
  const [wakeWordListening, setWakeWordListening] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wakeRecognitionRef = useRef<{ stop: () => void } | null>(null);
  // Audio queue for sentence-by-sentence TTS
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentenceBufferRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [orchestratorPlan, setOrchestratorPlan] = useState<{ agents: string[]; reasoning: string } | null>(null);
  // Session / Vision state
  const [sessionMode, setSessionMode] = useState<"temporary" | "expiring" | "permanent">("permanent");
  const [attachedImage, setAttachedImage] = useState<string | null>(null); // data URI
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSnap, setCameraSnap] = useState<string | null>(null); // data URI of captured frame
  const [liveQuery, setLiveQuery] = useState("What do you see?"); // standing question for live snapshots
  const [liveAnalyzing, setLiveAnalyzing] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [liveInterval, setLiveInterval] = useState(5); // seconds between captures
  const liveModeRef = useRef(false); // stable ref for use inside setInterval
  const loadingRef = useRef(false); // mirror of `loading` for interval callbacks
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const focusTimerRef = useRef<{ endAt: number; msgId: string } | null>(null);

  // Focus timer countdown — updates every second
  useEffect(() => {
    const iv = setInterval(() => {
      if (!focusTimerRef.current) return;
      const { endAt, msgId } = focusTimerRef.current;
      const rem = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      const mm = String(Math.floor(rem / 60)).padStart(2, "0");
      const ss = String(rem % 60).padStart(2, "0");
      if (rem === 0) {
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, content: "✅ Focus session complete! Great work — take a break." } : m
        ));
        focusTimerRef.current = null;
        fetch("http://localhost:8000/api/telegram/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "⏱️ Focus session complete! Time to take a break. 🎉" }),
        }).catch(() => {});
      } else {
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, content: `⏱️ Focus session — **${mm}:${ss}** remaining` } : m
        ));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch(`${API}/api/suggestions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.suggestions) setSuggestions(d.suggestions); })
      .catch(() => {});
  }, []);

  // Load a historical session when the parent passes one in
  useEffect(() => {
    if (!sessionToLoad) return;
    audioRef.current?.pause();
    audioRef.current = null;
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    setSpeaking(false);
    abortRef.current?.abort();
    switchSession(sessionToLoad.sessionId);
    const loaded: Message[] = sessionToLoad.messages.map(m => ({
      id: crypto.randomUUID(),
      role: m.role as Role,
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
      meta: m.meta?.model ? { model: m.meta.model, duration_ms: 0, tokens: { prompt: 0, completion: 0, total: 0 } } : undefined,
    }));
    setMessages(loaded);
    setInput("");
    setLoading(false);
    onSessionLoaded?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToLoad]);

  useEffect(() => {
    loadingRef.current = loading;
    if (loading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 100), 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);

  async function send(overrideText?: string, overrideImage?: string) {
    const text = (overrideText ?? input).trim();
    const imageToSend = overrideImage ?? attachedImage;
    if ((!text && !imageToSend) || loading) return;
    if (!overrideText) setInput("");

    // /task <title> [!low|!high] [today|tomorrow|monday|next week|in X days] — fast task create
    if (text.startsWith("/task ")) {
      const { title, priority, due_at } = parseTaskNLP(text.slice(6).trim());
      if (title) {
        const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        try {
          await fetch("http://localhost:8000/api/tasks/", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, priority, ...(due_at ? { due_at } : {}) }),
          });
          const dueLabel = due_at
            ? ` · due ${new Date(due_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
            : "";
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(), role: "assistant",
            content: `Task created: **${title}** [${priority}]${dueLabel} ✓`,
            timestamp: Date.now(),
          }]);
        } catch {
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(), role: "assistant",
            content: "Failed to create task — is the backend running?",
            timestamp: Date.now(),
          }]);
        }
      }
      return;
    }

    // /focus <minutes> — start a focus timer (default 25 min)
    if (text.startsWith("/focus")) {
      const mins = Math.min(Math.max(parseInt(text.slice(6).trim()) || 25, 1), 120);
      const timerId = crypto.randomUUID();
      const mm = String(mins).padStart(2, "0");
      const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() };
      const timerMsg: Message = { id: timerId, role: "assistant", content: `⏱️ Focus session — **${mm}:00** remaining`, timestamp: Date.now() };
      setMessages(prev => [...prev, userMsg, timerMsg]);
      focusTimerRef.current = { endAt: Date.now() + mins * 60 * 1000, msgId: timerId };
      return;
    }

    if (!overrideImage) setAttachedImage(null);
    if (imageToSend) setAnalyzingImage(true);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now(), image: imageToSend ?? undefined };
    const aiId = crypto.randomUUID();
    const aiMsg: Message = { id: aiId, role: "assistant", content: "", timestamp: Date.now(), streaming: true };

    // Snapshot history before adding new messages (exclude empty streaming placeholders)
    const history = messages
      .filter(m => !m.streaming && m.content)
      .map(m => ({ role: m.role, content: m.content }));

    setInput("");
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setLoading(true);

    abortRef.current = new AbortController();

    // ── Timeline mode: route to /api/timeline/chat instead ───────────────────
    if (timelineMode && !imageToSend) {
      try {
        const res = await fetch(`${API}/api/timeline/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, year: timelineYear, session_id: sessionId || undefined }),
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") break;
            try {
              const d = JSON.parse(payload);
              if (d.content) {
                accumulated += d.content;
                setMessages(prev => prev.map(m =>
                  m.id === aiId ? { ...m, content: m.content + d.content } : m
                ));
              }
            } catch { /* ignore */ }
          }
        }
        setMessages(prev => prev.map(m =>
          m.id === aiId ? { ...m, streaming: false, meta: { model: `Vijay·${timelineYear}`, duration_ms: 0, tokens: { prompt: 0, completion: 0, total: 0 } } } : m
        ));
        if (voiceEnabled && accumulated) speakText(accumulated);
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          setMessages(prev => prev.map(m =>
            m.id === aiId ? { ...m, content: `Error: ${(err as Error).message}`, streaming: false } : m
          ));
        }
      } finally {
        setLoading(false);
        setAnalyzingImage(false);
      }
      return;
    }

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/chat/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            image: imageToSend ?? undefined,
            history,
            sessionId: sessionId || undefined,
            systemPrompt: settings.systemPrompt || undefined,
            model: settings.model || undefined,
            temperature: settings.temperature,
            topP: settings.topP ? settings.topPValue : undefined,
            topK: settings.topK,
            minP: settings.minP ? settings.minPValue : undefined,
            presencePenalty: settings.presencePenalty ? settings.presencePenaltyValue : undefined,
            frequencyPenalty: settings.frequencyPenalty ? settings.frequencyPenaltyValue : undefined,
            repeatPenalty: settings.repeatPenalty ? settings.repeatPenaltyValue : undefined,
            maxTokens: settings.limitResponseLength ? settings.maxTokens : undefined,
            stopStrings: settings.stopStrings.length > 0 ? settings.stopStrings : undefined,
            enableThinking: settings.enableThinking,
            sessionMode,
            agentConfig: settings.agents,
          }),
          signal: abortRef.current.signal,
        }
      );

      if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try { const j = await res.json(); detail = j.detail || j.message || JSON.stringify(j); } catch {}
        throw new Error(detail);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);

          if (payload === "[DONE]") {
            setSearchQuery(null);
            setActiveAgents([]);
            setOrchestratorPlan(null);
            break;
          }

          if (payload.startsWith("[ORCHESTRATOR_PLAN]")) {
            try {
              const p = JSON.parse(payload.slice(19));
              setOrchestratorPlan(p);
              window.dispatchEvent(new CustomEvent("sj:agent", { detail: { type: "ORCHESTRATOR_PLAN", payload: { ...p, query: text } } }));
              window.dispatchEvent(new CustomEvent("sj:query", { detail: { query: text } }));
            } catch {}
            continue;
          }

          if (payload.startsWith("[AGENT_START]")) {
            try {
              const a = JSON.parse(payload.slice(13)) as ActiveAgent;
              setActiveAgents(prev => [...prev.filter(x => x.name !== a.name), a]);
              window.dispatchEvent(new CustomEvent("sj:agent", { detail: { type: "AGENT_START", payload: a } }));
            } catch {}
            continue;
          }

          if (payload.startsWith("[AGENT_DONE]")) {
            try {
              const p = JSON.parse(payload.slice(12));
              setActiveAgents(prev => prev.filter(x => x.name !== p.name));
              window.dispatchEvent(new CustomEvent("sj:agent", { detail: { type: "AGENT_DONE", payload: p } }));
            } catch {}
            continue;
          }

          if (payload.startsWith("[AGENT_ERROR]")) {
            try {
              const p = JSON.parse(payload.slice(13));
              setActiveAgents(prev => prev.filter(x => x.name !== p.name));
              window.dispatchEvent(new CustomEvent("sj:agent", { detail: { type: "AGENT_ERROR", payload: p } }));
            } catch {}
            continue;
          }

          if (payload.startsWith("[AGENT_TOOL]")) {
            try { window.dispatchEvent(new CustomEvent("sj:agent", { detail: { type: "AGENT_TOOL", payload: JSON.parse(payload.slice(12)) } })); } catch {}
            continue;
          }

          if (payload.startsWith("[AGENT_TOOL_RESULT]")) {
            try { window.dispatchEvent(new CustomEvent("sj:agent", { detail: { type: "AGENT_TOOL_RESULT", payload: JSON.parse(payload.slice(19)) } })); } catch {}
            continue;
          }

          if (payload.startsWith("[PLAN_CREATED]")) {
            try {
              const p = JSON.parse(payload.slice(14));
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, planCreated: p } : m
              ));
            } catch {}
            continue;
          }

          if (payload.startsWith("[IT_REPAIR_STARTED]")) {
            try {
              const d = JSON.parse(payload.slice(19));
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, darwinTriggered: d } : m
              ));
            } catch {}
            continue;
          }

          if (payload.startsWith("[CHAIN_PLAN]")) {
            try {
              const p = JSON.parse(payload.slice(12)) as { steps: string[] };
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, chainPlan: p } : m
              ));
            } catch {}
            continue;
          }

          if (payload.startsWith("[CHAIN_STEP]")) {
            try {
              const step = JSON.parse(payload.slice(12)) as ChainStep;
              setMessages(prev => prev.map(m => {
                if (m.id !== aiId) return m;
                const existing = m.chainSteps || [];
                const idx = existing.findIndex(s => s.step === step.step);
                if (idx >= 0) {
                  const updated = [...existing];
                  updated[idx] = { ...updated[idx], ...step };
                  return { ...m, chainSteps: updated };
                }
                return { ...m, chainSteps: [...existing, step] };
              }));
            } catch {}
            continue;
          }

          if (payload.startsWith("[APPROVAL_NEEDED]")) {
            try {
              const p = JSON.parse(payload.slice(17)) as Omit<PendingApproval, "aiId">;
              setPendingApproval({ ...p, aiId });
            } catch {}
            continue;
          }

          if (payload.startsWith("[CHAIN_DONE]")) {
            // Summary text comes as plain chunks after this; nothing to do here
            continue;
          }

          if (payload.startsWith("[CHAIN_ERROR]")) {
            try {
              const { message: errMsg } = JSON.parse(payload.slice(13)) as { message: string };
              setMessages(prev => prev.map(m => {
                if (m.id !== aiId) return m;
                // Mark all still-thinking steps as error
                const updatedSteps = (m.chainSteps || []).map(s =>
                  s.status === "thinking" ? { ...s, status: "error" as const } : s
                );
                return { ...m, chainSteps: updatedSteps, chainError: errMsg };
              }));
            } catch {}
            continue;
          }

          if (payload.startsWith("[ERROR]")) {
            try {
              const errText = JSON.parse(payload.slice(7)) as string;
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, content: `Error: ${errText}`, streaming: false } : m
              ));
            } catch {}
            break;
          }
          if (payload === "[SEARCHING_DONE]") { setSearchQuery(null); continue; }

          if (payload.startsWith("[SEARCHING]")) {
            const query = JSON.parse(payload.slice(11));
            setSearchQuery(query);
            continue;
          }

          if (payload.startsWith("[THINKING]")) {
            try {
              const thinkingText = JSON.parse(payload.slice(10)) as string;
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, thinking: thinkingText } : m
              ));
            } catch {}
            continue;
          }

          if (payload.startsWith("[META]")) {
            const meta = JSON.parse(payload.slice(6));
            setMessages(prev => prev.map(m =>
              m.id === aiId ? { ...m, streaming: false, meta: { model: meta.model, duration_ms: meta.duration_ms, tokens: meta.tokens } } : m
            ));
            window.dispatchEvent(new CustomEvent("sj:tokens", { detail: meta }));
            continue;
          }

          // Restore newlines that were escaped for SSE transport
          const chunk = payload.replace(/\\n/g, "\n");
          setMessages(prev => prev.map(m =>
            m.id === aiId ? { ...m, content: m.content + chunk } : m
          ));
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });

          // Sentence-by-sentence TTS: enqueue as sentences complete
          if (voiceEnabled) {
            sentenceBufferRef.current += chunk;
            const sentenceEnd = /[.!?][)\s"']/.exec(sentenceBufferRef.current);
            if (sentenceEnd) {
              const sentence = sentenceBufferRef.current.slice(0, sentenceEnd.index + 1);
              sentenceBufferRef.current = sentenceBufferRef.current.slice(sentenceEnd.index + 1).trimStart();
              enqueueSentence(sentence);
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setActiveAgents([]);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isFetchFail = msg.includes("fetch") || msg.includes("Failed") || msg.includes("NetworkError");
      setMessages(prev => prev.map(m =>
        m.id === aiId ? {
          ...m,
          content: isFetchFail
            ? `Cannot reach backend (http://localhost:8000). Is FastAPI running?\n\nError: ${msg}`
            : `Error: ${msg}`,
          streaming: false,
        } : m
      ));
    } finally {
      setLoading(false);
      setAnalyzingImage(false);
      setActiveAgents([]);
      setMessages(prev => {
        const updated = prev.map(m => m.id === aiId ? { ...m, streaming: false } : m);
        // Flush any remaining sentence buffer
        if (voiceEnabled && sentenceBufferRef.current.trim()) {
          enqueueSentence(sentenceBufferRef.current.trim());
          sentenceBufferRef.current = "";
        }
        return updated;
      });
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // ── Image resize helper — caps at 800px and re-encodes to JPEG 0.75 quality ──
  function resizeImage(dataUrl: string, maxPx = 800): Promise<string> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = dataUrl;
    });
  }

  // ── Clipboard paste (Ctrl+V / right-click paste) ─────────────────────────
  async function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(i => i.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const resized = await resizeImage(ev.target?.result as string);
      setAttachedImage(resized);
    };
    reader.readAsDataURL(file);
  }

  // ── Image file upload ─────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const resized = await resizeImage(ev.target?.result as string);
      setAttachedImage(resized);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── Camera modal ──────────────────────────────────────────────────────────
  async function openCamera() {
    setCameraOpen(true);
    setCameraSnap(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      cameraStreamRef.current = stream;
      // videoRef is attached once the modal renders; apply stream in useEffect
    } catch {
      alert("Camera access denied.");
      setCameraOpen(false);
    }
  }

  function snapCamera() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setCameraSnap(canvas.toDataURL("image/jpeg", 0.85));
  }

  function retakeCamera() {
    setCameraSnap(null);
  }

  async function confirmCamera() {
    if (cameraSnap) {
      const resized = await resizeImage(cameraSnap);
      setAttachedImage(resized);
    }
    closeCamera();
  }

  // ── Capture current video frame as resized JPEG data URI ─────────────────
  async function captureFrame(): Promise<string | null> {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    return resizeImage(canvas.toDataURL("image/jpeg", 0.85));
  }

  // ── Single Snap & Ask (manual) ────────────────────────────────────────────
  async function snapAndAnalyze() {
    if (liveAnalyzing) return;
    const resized = await captureFrame();
    if (!resized) return;
    setLiveAnalyzing(true);
    await send(liveQuery, resized);
    setLiveAnalyzing(false);
  }

  // ── Live Mode: start / stop interval loop ─────────────────────────────────
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startLiveMode() {
    liveModeRef.current = true;
    setLiveMode(true);
    // Kick off immediately then repeat
    runLiveCapture();
    liveIntervalRef.current = setInterval(runLiveCapture, liveInterval * 1000);
  }

  function stopLiveMode() {
    liveModeRef.current = false;
    setLiveMode(false);
    if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
  }

  async function runLiveCapture() {
    if (!liveModeRef.current || loadingRef.current) return;
    const resized = await captureFrame();
    if (!resized || !liveModeRef.current) return;
    await send(liveQuery, resized);
  }

  // Stop live mode if camera closes
  function closeCamera() {
    stopLiveMode();
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
    setCameraSnap(null);
  }

  // Attach stream to <video> whenever the camera opens
  useEffect(() => {
    if (cameraOpen && videoRef.current && cameraStreamRef.current && !cameraSnap) {
      videoRef.current.srcObject = cameraStreamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOpen, cameraSnap]);

  // ── Voice recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (recording || loading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      alert("Microphone access denied.");
    }
  }, [recording, loading]);

  // ── SSE transcription helper ──────────────────────────────────────────────
  async function streamTranscription(
    wav: Blob,
    onPartial: (text: string) => void,
  ): Promise<string> {
    const form = new FormData();
    form.append("audio", wav, "recording.wav");
    const res = await fetch(`${API}/api/voice/transcribe-stream`, { method: "POST", body: form });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return full;
        try {
          const { full: f } = JSON.parse(payload);
          full = f;
          onPartial(full);
        } catch {}
      }
    }
    return full;
  }

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || !recording) return;
    setRecording(false);

    await new Promise<void>(resolve => {
      mr.onstop = () => resolve();
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    });

    if (chunksRef.current.length === 0) return;
    setTranscribing(true);
    setInput("🎤 Transcribing...");
    try {
      const raw = new Blob(chunksRef.current, { type: "audio/webm" });
      const wav = await blobToWav(raw);
      const finalText = await streamTranscription(wav, t => setInput(t));
      if (finalText) send(finalText);
      else setInput("");
    } catch (e) {
      console.error("Transcription error", e);
      setInput("");
    } finally {
      setTranscribing(false);
    }
  }, [recording]);

  // ── Audio queue: play TTS clips sequentially ─────────────────────────────
  const playNext = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      audioPlayingRef.current = false;
      setSpeaking(false);
      return;
    }
    audioPlayingRef.current = true;
    setSpeaking(true);
    const url = audioQueueRef.current.shift()!;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { URL.revokeObjectURL(url); playNext(); };
    audio.onerror = () => { URL.revokeObjectURL(url); playNext(); };
    audio.play().catch(playNext);
  }, []);

  const enqueueSentence = useCallback(async (sentence: string) => {
    if (!voiceEnabled) return;
    const clean = sentence.replace(/[*_`#>\[\]]/g, "").trim();
    if (!clean || clean.length < 3) return;
    try {
      const res = await fetch(`${API}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: settings.ttsVoice || "en-US-AriaNeural" }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioQueueRef.current.push(url);
      if (!audioPlayingRef.current) playNext();
    } catch {}
  }, [voiceEnabled, playNext]);

  // Full-text TTS (used after complete response when always-on is off)
  const speakText = useCallback(async (text: string) => {
    if (!voiceEnabled || !text) return;
    const clean = text.replace(/[*_`#>\[\]]/g, "").trim();
    if (!clean) return;
    await enqueueSentence(clean);
  }, [voiceEnabled, enqueueSentence]);

  function stopSpeaking() {
    audioRef.current?.pause();
    audioRef.current = null;
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    setSpeaking(false);
  }

  // ── VAD: handle end of detected speech ───────────────────────────────────
  const handleVADSpeechEnd = useCallback(async (blob: Blob) => {
    if (loading || transcribing) return;
    setTranscribing(true);
    setInput("🎤 Listening...");
    try {
      const wav = await blobToWav(blob);
      const finalText = await streamTranscription(wav, t => setInput(t));
      if (finalText) send(finalText);
      else setInput("");
    } catch (e) {
      console.error("VAD transcription error", e);
      setInput("");
    } finally {
      setTranscribing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, transcribing]);

  // ── Always-on VAD ─────────────────────────────────────────────────────────
  useVAD({
    enabled: alwaysOnVoice,
    paused: speaking || loading || transcribing,
    onSpeechStart: () => setVadListening(true),
    onSpeechEnd: (blob) => { setVadListening(false); handleVADSpeechEnd(blob); },
  });

  // ── Wake word via browser SpeechRecognition (zero local CPU, cloud-based) ──
  // Suppressed when globalVoiceActive — the page-level useGlobalVoice handles it instead.
  useEffect(() => {
    if (!wakeWordEnabled || globalVoiceActive) {
      wakeRecognitionRef.current?.stop();
      wakeRecognitionRef.current = null;
      setWakeWordListening(false);
      return;
    }

    type SRResult = { [j: number]: { transcript: string } };
    type SRResultList = { [i: number]: SRResult; length: number };
    type SREvent = { resultIndex: number; results: SRResultList };
    type SRConstructor = new () => { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; onresult: ((e: SREvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
    const w = window as typeof window & { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SR) {
      alert("Wake word requires a browser with SpeechRecognition support (Chrome/Edge).");
      setWakeWordEnabled(false);
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.toLowerCase();
        if (text.includes("jazper") || text.includes("jasper")) {
          // Wake word detected — activate one VAD capture if not already active
          if (!alwaysOnVoice && !transcribing && !loading) {
            setAlwaysOnVoice(true);
            setVoiceEnabled(true);
            // Auto-deactivate after 8s of no speech (VAD handles the actual capture)
            setTimeout(() => setAlwaysOnVoice(false), 8000);
          }
        }
      }
    };

    rec.onerror = () => {
      // Restart on error (common with continuous mode)
      if (wakeWordEnabled) setTimeout(() => rec.start(), 1000);
    };

    rec.onend = () => {
      if (wakeWordEnabled) rec.start();
    };

    rec.start();
    wakeRecognitionRef.current = rec;
    setWakeWordListening(true);

    return () => {
      rec.stop();
      wakeRecognitionRef.current = null;
      setWakeWordListening(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled]);

  function clearChat() {
    setMessages([]);
    newSession();
  }

  const totalTokens = messages.reduce((s, m) => s + (m.meta?.tokens.total ?? 0), 0);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <MessageSquare size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Chat</span>
        {timelineMode && (
          <span style={{
            display: "flex", alignItems: "center", gap: 3, fontSize: 10,
            color: "#a78bfa",
            background: "rgba(167,139,250,0.12)",
            border: "1px solid rgba(167,139,250,0.3)",
            borderRadius: 4, padding: "1px 7px", fontWeight: 700,
          }}>
            🕰 {timelineYear}
          </span>
        )}
        {sessionMode === "temporary" && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--color-text-muted)", background: "color-mix(in srgb, #a855f7 15%, transparent)", border: "1px solid #a855f750", borderRadius: 4, padding: "1px 6px" }}>
            <Ghost size={9} /> Temporary
          </span>
        )}
        {sessionMode === "expiring" && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--color-text-muted)", background: "color-mix(in srgb, #f59e0b 15%, transparent)", border: "1px solid #f59e0b50", borderRadius: 4, padding: "1px 6px" }}>
            <Clock size={9} /> 24h
          </span>
        )}
        <div className="sj-ml-auto sj-flex sj-items-center sj-gap-2">
          {totalTokens > 0 && <span className="sj-badge">{totalTokens.toLocaleString()} tokens</span>}
          {/* Live agent activity bar */}
          {activeAgents.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {activeAgents.map(a => (
                <span key={a.name} className="sj-micro" style={{
                  display: "flex", alignItems: "center", gap: 3,
                  color: "var(--color-accent)",
                  background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)",
                  borderRadius: "var(--r-xs)", padding: "1px 6px",
                }}>
                  <span style={{ animation: "pulse 1.2s ease infinite" }}>{AGENT_EMOJI[a.name] || "🤖"}</span>
                  {a.name}
                  {AGENT_ICON[a.name]}
                </span>
              ))}
            </div>
          )}

          {analyzingImage && !searchQuery && activeAgents.length === 0 && (
            <span className="sj-micro" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-accent)" }}>
              <Camera size={10} style={{ animation: "spin 1.5s linear infinite" }} />
              Analyzing image...
            </span>
          )}
          {searchQuery && activeAgents.length === 0 && (
            <span className="sj-micro" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-text-secondary)" }}>
              <Globe size={10} style={{ animation: "spin 1.5s linear infinite" }} />
              {searchQuery}
            </span>
          )}
          {loading && !searchQuery && !analyzingImage && activeAgents.length === 0 && (
            <span className="sj-micro" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(elapsed)}</span>
          )}
          <span className="sj-micro">{messages.filter(m => m.role === "user").length} messages</span>

          {/* TTS toggle */}
          <button
            onClick={() => { setVoiceEnabled(v => !v); stopSpeaking(); }}
            title={voiceEnabled ? "Disable voice output" : "Enable voice output"}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: voiceEnabled ? "var(--color-accent)" : "var(--color-text-muted)",
              display: "flex", alignItems: "center", borderRadius: "var(--r-xs)",
            }}
          >
            {voiceEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
          </button>

          {/* Timeline mode toggle + year picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <button
              onClick={() => setTimelineMode(v => !v)}
              title={timelineMode ? `Exit Timeline mode (currently ${timelineYear})` : "Timeline Mode — chat as yourself from a past year"}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
                color: timelineMode ? "#a78bfa" : "var(--color-text-muted)",
                display: "flex", alignItems: "center", gap: 3, borderRadius: "var(--r-xs)",
                outline: timelineMode ? "1px solid #a78bfa55" : "none",
                fontSize: 11,
              }}
            >
              <span style={{ fontSize: 12 }}>🕰</span>
              {timelineMode && (
                <span style={{ fontSize: 10, color: "#a78bfa", fontWeight: 700 }}>
                  {timelineYear}
                </span>
              )}
            </button>
            {timelineMode && (
              <select
                value={timelineYear}
                onChange={e => setTimelineYear(Number(e.target.value))}
                title="Select year"
                style={{
                  background: "#1e1b4b", border: "1px solid #a78bfa55",
                  borderRadius: 4, color: "#a78bfa", fontSize: 10,
                  padding: "1px 4px", cursor: "pointer", outline: "none",
                }}
              >
                {Array.from({ length: currentYear - 2009 }, (_, i) => currentYear - i).map(y => (
                  <option key={y} value={y} style={{ background: "#1e1b4b" }}>
                    {y}{timelineYears.includes(y) ? " ●" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Always-on VAD toggle */}
          <button
            onClick={() => {
              if (alwaysOnVoice) { setAlwaysOnVoice(false); setVadListening(false); }
              else { setAlwaysOnVoice(true); setVoiceEnabled(true); }
            }}
            title={alwaysOnVoice ? "Disable always-on listening" : "Enable always-on listening"}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: alwaysOnVoice ? "var(--color-accent)" : "var(--color-text-muted)",
              display: "flex", alignItems: "center", gap: 3, borderRadius: "var(--r-xs)",
              outline: alwaysOnVoice ? "1px solid var(--color-accent)" : "none",
            }}
          >
            <Radio size={11} />
            {alwaysOnVoice && (
              <span className="sj-micro" style={{ color: "var(--color-accent)" }}>
                {vadListening ? "Listening..." : speaking ? "Speaking..." : transcribing ? "Processing..." : "On"}
              </span>
            )}
          </button>

          {/* Wake word toggle — off by default, cloud-based (Chrome/Edge) */}
          <button
            onClick={() => setWakeWordEnabled(v => !v)}
            title={globalVoiceActive ? 'Wake word handled by Voice-First Mode (Ctrl+Shift+V)' : wakeWordEnabled ? 'Disable wake word ("Hey Jazper")' : 'Enable wake word — say "Jazper" to activate mic (Chrome/Edge only)'}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: wakeWordEnabled ? "var(--color-accent)" : "var(--color-text-muted)",
              display: "flex", alignItems: "center", gap: 3, borderRadius: "var(--r-xs)",
              outline: wakeWordEnabled ? "1px solid var(--color-accent)" : "none",
            }}
          >
            <Zap size={11} />
            {wakeWordEnabled && (
              <span className="sj-micro" style={{ color: "var(--color-accent)" }}>
                {wakeWordListening ? "Wake" : "..."}
              </span>
            )}
          </button>

          {/* Speaking indicator with stop */}
          {speaking && (
            <button onClick={stopSpeaking} title="Stop speaking" style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: "var(--color-accent)", display: "flex", alignItems: "center", gap: 3,
              borderRadius: "var(--r-xs)",
            }}>
              <span className="sj-dot sj-dot-live" />
              <span className="sj-micro">Speaking</span>
            </button>
          )}

          {messages.length > 0 && (
            <button onClick={clearChat} title="New chat" style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
              color: "var(--color-text-muted)", display: "flex", alignItems: "center",
              borderRadius: "var(--r-xs)",
            }}>
              <SquarePen size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable messages */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-3) var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--sp-3)" }}>
            <span style={{ fontSize: 28 }}>⚡</span>
            <p className="sj-subheading">Sir Jazper</p>
            <p className="sj-micro">Send a message to begin. Text streams in real-time.</p>
            {/* Session mode picker */}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {([
                { id: "permanent", icon: <Save size={11} />, label: "Saved", desc: "Stays in history" },
                { id: "expiring",  icon: <Clock size={11} />, label: "24h",   desc: "Auto-deleted after 24h" },
                { id: "temporary", icon: <Ghost size={11} />, label: "Temp",  desc: "Never saved" },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setSessionMode(opt.id)}
                  title={opt.desc}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 10px", borderRadius: "var(--r-md)", cursor: "pointer", fontSize: 11,
                    border: sessionMode === opt.id ? "1px solid var(--color-cta-bg)" : "var(--border)",
                    background: sessionMode === opt.id ? "color-mix(in srgb, var(--color-cta-bg) 15%, transparent)" : "var(--color-surface-float)",
                    color: sessionMode === opt.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    transition: "var(--ease-soft)",
                  }}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
            <p className="sj-micro" style={{ opacity: 0.5 }}>
              {sessionMode === "temporary" ? "This chat will never be saved to history" :
               sessionMode === "expiring"  ? "This chat will be deleted after 24 hours" :
               "This chat will be saved to history"}
            </p>

            {/* Suggested prompts */}
            {suggestions.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 12, maxWidth: 480 }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(s)}
                    style={{
                      padding: "5px 11px",
                      borderRadius: "var(--r-md)",
                      fontSize: 11,
                      cursor: "pointer",
                      border: "var(--border)",
                      background: "var(--color-surface-float)",
                      color: "var(--color-text-muted)",
                      transition: "var(--ease-soft)",
                      textAlign: "left",
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-accent)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-muted)";
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, idx) =>
          msg.role === "assistant"
            ? <AIMessage key={msg.id} msg={msg} ttsVoice={settings.ttsVoice} hadImage={!!(messages[idx - 1]?.image)} />
            : (
              <div key={msg.id} className="sj-chat-message sj-fade-in">
                <div className="sj-chat-avatar sj-chat-avatar-user">U</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", alignItems: "flex-end" }}>
                  {msg.image && (
                    <img
                      src={msg.image}
                      alt="attached"
                      style={{ maxWidth: 200, maxHeight: 200, borderRadius: "var(--r-md)", border: "var(--border-hi)", objectFit: "cover" }}
                    />
                  )}
                  {msg.content && (
                    <div className="sj-chat-bubble sj-chat-bubble-user" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {msg.content}
                    </div>
                  )}
                </div>
              </div>
            )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "var(--sp-3) var(--sp-4)", borderTop: "var(--border)",
        display: "flex", flexDirection: "column", gap: "var(--sp-2)",
        background: "var(--color-surface)", flexShrink: 0,
      }}>
        {/* Attached image preview */}
        {attachedImage && (
          <div style={{ position: "relative", display: "inline-flex", alignSelf: "flex-start" }}>
            <img
              src={attachedImage}
              alt="attached"
              style={{ maxHeight: 80, maxWidth: 120, borderRadius: "var(--r-md)", border: "var(--border-hi)", objectFit: "cover" }}
            />
            <button
              onClick={() => setAttachedImage(null)}
              title="Remove image"
              style={{
                position: "absolute", top: -6, right: -6,
                background: "var(--color-surface-raised)", border: "var(--border-hi)",
                borderRadius: "50%", width: 16, height: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", padding: 0, color: "var(--color-text-muted)",
              }}
            >
              <X size={9} />
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-end" }}>
          <textarea
            className="sj-textarea"
            placeholder={recording ? "Recording — release to transcribe..." : transcribing ? "Transcribing..." : "Message Sir Jazper... (Enter to send, Shift+Enter for new line)"}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            rows={2}
            style={{ flex: 1, maxHeight: 120, opacity: transcribing ? 0.5 : 1 }}
            disabled={transcribing}
          />

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          {/* Attach image button */}
          <button
            className="sj-btn-icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title="Attach image"
            style={{ marginBottom: 2, color: attachedImage ? "var(--color-accent)" : "var(--color-text-muted)", opacity: loading ? 0.4 : 1 }}
          >
            <Paperclip size={13} />
          </button>

          {/* Camera capture button */}
          <button
            className="sj-btn-icon"
            onClick={openCamera}
            disabled={loading}
            title="Capture from camera"
            style={{ marginBottom: 2, color: "var(--color-text-muted)", opacity: loading ? 0.4 : 1 }}
          >
            <Camera size={13} />
          </button>

          {/* Mic button — hold to record */}
          <button
            className="sj-btn-icon"
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={loading || transcribing}
            title="Hold to speak"
            style={{
              marginBottom: 2,
              color: recording ? "var(--color-accent)" : transcribing ? "var(--color-accent)" : "var(--color-text-muted)",
              opacity: loading ? 0.4 : 1,
              outline: recording ? "1px solid var(--color-accent)" : "none",
              animation: recording ? "pulse 1s ease infinite" : "none",
            }}
          >
            {transcribing ? <MicOff size={13} /> : <Mic size={13} />}
          </button>

          <button
            className="sj-btn-icon"
            onClick={() => send()}
            disabled={(!input.trim() && !attachedImage) || loading}
            style={{ opacity: ((!input.trim() && !attachedImage) || loading) ? 0.4 : 1, marginBottom: 2 }}
          >
            <Send size={13} />
          </button>
        </div>
      </div>

      {/* Camera modal */}
      {cameraOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.75)", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "var(--color-surface-raised)", border: "var(--border-hi)",
            borderRadius: "var(--r-lg)", padding: "var(--sp-4)",
            display: "flex", flexDirection: "column", gap: "var(--sp-3)",
            minWidth: 340, maxWidth: "90vw",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <span className="sj-label">Camera</span>
                {liveMode && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--color-accent)", background: "color-mix(in srgb, var(--color-accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)", borderRadius: 4, padding: "1px 6px" }}>
                    <span className="sj-dot sj-dot-live" /> Live
                  </span>
                )}
              </div>
              <button onClick={closeCamera} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)" }}>
                <X size={14} />
              </button>
            </div>

            {cameraSnap ? (
              <img src={cameraSnap} alt="snapshot" style={{ borderRadius: "var(--r-md)", maxHeight: 300, objectFit: "contain" }} />
            ) : (
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ borderRadius: "var(--r-md)", maxHeight: 300, width: "100%", objectFit: "cover", background: "#000" }}
              />
            )}

            {/* Query + live mode controls */}
            {!cameraSnap && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <input
                  className="sj-input"
                  value={liveQuery}
                  onChange={e => setLiveQuery(e.target.value)}
                  placeholder="Ask about what you see..."
                  style={{ fontSize: 12 }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <span className="sj-micro" style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Every</span>
                  <input
                    type="range" min={2} max={30} step={1} value={liveInterval}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setLiveInterval(v);
                      if (liveMode) {
                        if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
                        liveIntervalRef.current = setInterval(runLiveCapture, v * 1000);
                      }
                    }}
                    style={{ flex: 1, accentColor: "var(--color-accent)" }}
                  />
                  <span className="sj-mono" style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 30 }}>{liveInterval}s</span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
              {cameraSnap ? (
                <>
                  <button className="sj-btn" onClick={retakeCamera}>Retake</button>
                  <button className="sj-btn sj-btn-primary" onClick={confirmCamera}>Use Photo</button>
                </>
              ) : (
                <>
                  <button className="sj-btn" onClick={snapCamera} disabled={liveMode}>
                    <Camera size={12} style={{ marginRight: 4 }} /> Snap
                  </button>
                  <button
                    className="sj-btn"
                    onClick={snapAndAnalyze}
                    disabled={liveAnalyzing || loading || liveMode}
                    title="Capture and send to Jazper immediately"
                  >
                    {liveAnalyzing ? "Analyzing…" : <><Play size={12} style={{ marginRight: 4 }} /> Snap & Ask</>}
                  </button>
                  <button
                    className="sj-btn sj-btn-primary"
                    onClick={liveMode ? stopLiveMode : startLiveMode}
                    title={liveMode ? "Stop live mode" : "Start live mode — Jazper watches continuously"}
                    style={liveMode ? { background: "color-mix(in srgb, var(--color-accent) 20%, transparent)", borderColor: "var(--color-accent)", color: "var(--color-accent)" } : {}}
                  >
                    {liveMode
                      ? <><Square size={12} style={{ marginRight: 4 }} /> Stop Live</>
                      : <><Radio size={12} style={{ marginRight: 4 }} /> Go Live</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approval gate modal — shown when chain loop needs user confirmation */}
      {pendingApproval && (
        <ApprovalModal
          approval={pendingApproval}
          sessionId={sessionId}
          onDone={() => setPendingApproval(null)}
        />
      )}
    </div>
  );
}
