"use client";

import dynamic from "next/dynamic";
import { Square, Trash2, CheckCircle, Loader2, XCircle, Clock } from "lucide-react";
import { useVoiceConversation, type ConvState, type Turn, type ChainStep } from "@/hooks/useVoiceConversation";

// Three.js Canvas is browser-only — skip SSR
const VoiceCanvas = dynamic(
  () => import("@/components/voice/ConversationSphere").then(m => ({ default: m.VoiceCanvas })),
  { ssr: false, loading: () => <div style={{ flex: 1 }} /> }
);

const STATE_LABEL: Record<ConvState, string> = {
  idle:       "Voice Mode",
  listening:  "Listening…",
  processing: "Processing…",
  thinking:   "Thinking…",
  speaking:   "Speaking…",
  error:      "Recovering…",
  chaining:   "Executing…",
};

const STATE_COLOR: Record<ConvState, string> = {
  idle:       "#4f46e5",
  listening:  "#0d9488",
  processing: "#d97706",
  thinking:   "#7c3aed",
  speaking:   "#2563eb",
  error:      "#dc2626",
  chaining:   "#f59e0b",
};

export function VoiceModePanel() {
  const {
    state, stateRef, amplitudeRef,
    transcript, history, chainSteps,
    interrupt, clearHistory,
  } = useVoiceConversation(true);

  const color    = STATE_COLOR[state];
  const canStop  = state === "speaking" || state === "thinking" || state === "chaining";

  return (
    <div style={{
      position:      "relative",
      width:         "100%",
      height:        "100%",
      display:       "flex",
      flexDirection: "column",
      background:    "#04040b",
      overflow:      "hidden",
      userSelect:    "none",
    }}>

      {/* ── Three.js sphere (top 55%) ────────────────────────────────────────── */}
      <div style={{ flex: "0 0 55%", position: "relative", minHeight: 0 }}>
        <VoiceCanvas stateRef={stateRef} amplitudeRef={amplitudeRef} />

        {/* State label floating over sphere bottom */}
        <div style={{
          position:       "absolute",
          bottom:         20,
          left:           "50%",
          transform:      "translateX(-50%)",
          display:        "flex",
          alignItems:     "center",
          gap:            8,
          color,
          fontSize:       12,
          fontWeight:     500,
          letterSpacing:  "0.08em",
          textTransform:  "uppercase",
          transition:     "color 0.4s ease",
          pointerEvents:  "none",
          whiteSpace:     "nowrap",
        }}>
          <span style={{
            display:      "inline-block",
            width:        6,
            height:       6,
            borderRadius: "50%",
            background:   color,
            flexShrink:   0,
            animation:    (state === "listening" || state === "speaking")
              ? "vmDot 0.7s ease-in-out infinite"
              : state === "thinking"
                ? "vmDot 1.3s ease-in-out infinite"
                : "none",
          }} />
          {STATE_LABEL[state]}
        </div>
      </div>

      {/* ── Conversation transcript (flex grow) ─────────────────────────────── */}
      <div style={{
        flex:           "1 1 0",
        overflowY:      "auto",
        padding:        "16px 28px 8px",
        display:        "flex",
        flexDirection:  "column",
        gap:            10,
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(255,255,255,0.06) transparent",
      }}>
        {history.length === 0 && (
          <p style={{
            color:      "rgba(255,255,255,0.12)",
            fontSize:   12,
            textAlign:  "center",
            marginTop:  12,
            lineHeight: 1.6,
          }}>
            Speak naturally — Jazper is always listening.
            <br />
            No wake word needed.
          </p>
        )}

        {history.map(turn => <TurnBubble key={turn.id} turn={turn} />)}

        {/* Chain step overlay when executing multi-step voice commands */}
        {chainSteps.length > 0 && (
          <div style={{
            background:   "rgba(245,158,11,0.05)",
            border:       "1px solid rgba(245,158,11,0.15)",
            borderRadius: 10,
            padding:      "10px 14px",
            display:      "flex",
            flexDirection: "column",
            gap:          6,
          }}>
            <div style={{
              fontSize:      9,
              fontWeight:    600,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color:         "#f59e0b",
              marginBottom:  2,
            }}>
              Executing chain
            </div>
            {chainSteps.map((step) => (
              <ChainStepRow key={step.index} step={step} />
            ))}
          </div>
        )}

        {/* Live transcript flash while processing */}
        {transcript && (state === "processing" || state === "thinking") && (
          <div style={{
            alignSelf:    "flex-end",
            maxWidth:     "78%",
            background:   "rgba(13,148,136,0.07)",
            border:       "1px solid rgba(13,148,136,0.2)",
            borderRadius: 12,
            padding:      "8px 14px",
            fontSize:     13,
            color:        "rgba(255,255,255,0.4)",
            fontStyle:    "italic",
          }}>
            {transcript}
          </div>
        )}
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink:     0,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        gap:            12,
        padding:        "10px 24px 18px",
        borderTop:      "1px solid rgba(255,255,255,0.04)",
      }}>
        <CtrlButton
          icon={<Square size={11} />}
          label="Stop"
          onClick={interrupt}
          disabled={!canStop}
          active={canStop}
          activeColor="#93c5fd"
        />
        <CtrlButton
          icon={<Trash2 size={11} />}
          label="Clear"
          onClick={clearHistory}
          disabled={history.length === 0}
        />
      </div>

      <style>{`
        @keyframes vmDot {
          0%, 100% { opacity: 0.4; transform: scale(1);   }
          50%       { opacity: 1;   transform: scale(1.4); }
        }
        @keyframes vmSpin {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TurnBubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth:     "80%",
        background:   isUser
          ? "rgba(13,148,136,0.10)"
          : "rgba(37,99,235,0.08)",
        border:       `1px solid ${isUser ? "rgba(13,148,136,0.22)" : "rgba(37,99,235,0.16)"}`,
        borderRadius: 12,
        padding:      "8px 14px",
        fontSize:     13,
        color:        isUser ? "#e2e8f0" : "#cbd5e1",
        lineHeight:   1.55,
      }}>
        <div style={{
          fontSize:      9,
          fontWeight:    600,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom:  5,
          color:         isUser ? "#0d9488" : "#2563eb",
        }}>
          {isUser ? "You" : "Jazper"}
        </div>
        {turn.content}
      </div>
    </div>
  );
}

function ChainStepRow({ step }: { step: ChainStep }) {
  const Icon =
    step.status === "done"    ? CheckCircle :
    step.status === "error"   ? XCircle     :
    step.status === "running" ? Loader2     : Clock;

  const iconColor =
    step.status === "done"    ? "#10b981" :
    step.status === "error"   ? "#ef4444" :
    step.status === "running" ? "#f59e0b" : "rgba(255,255,255,0.25)";

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{ color: iconColor, marginTop: 1, flexShrink: 0 }}>
        <Icon
          size={12}
          style={step.status === "running" ? { animation: "vmSpin 1s linear infinite" } : undefined}
        />
      </span>
      <div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.4 }}>
          {step.step}
        </div>
        {step.result && (
          <div style={{
            fontSize:    11,
            color:       "rgba(255,255,255,0.38)",
            marginTop:   2,
            whiteSpace:  "pre-wrap",
            lineHeight:  1.4,
            maxHeight:   60,
            overflow:    "hidden",
          }}>
            {step.result}
          </div>
        )}
      </div>
    </div>
  );
}

function CtrlButton({
  icon, label, onClick, disabled, active, activeColor,
}: {
  icon:         React.ReactNode;
  label:        string;
  onClick:      () => void;
  disabled:     boolean;
  active?:      boolean;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display:     "flex",
        alignItems:  "center",
        gap:         5,
        padding:     "7px 16px",
        borderRadius: 7,
        border:      "1px solid rgba(255,255,255,0.07)",
        background:  active ? `${activeColor ?? "#fff"}18` : "transparent",
        color:       disabled ? "rgba(255,255,255,0.12)"
                              : active ? (activeColor ?? "#fff")
                                       : "rgba(255,255,255,0.35)",
        cursor:      disabled ? "default" : "pointer",
        fontSize:    12,
        transition:  "all 0.2s",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
