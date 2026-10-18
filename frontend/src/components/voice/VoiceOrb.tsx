"use client";

/**
 * VoiceOrb — floating voice status indicator for Voice-First / Conversation Mode.
 *
 * States:
 *   off          → mic-off button, click to enable
 *   wake         → slow indigo pulse, "Say: Hey Jazper"
 *   listening    → bright green fast pulse, recording
 *   transcribing → amber spinner
 *   thinking     → blue brain pulse, first sentence generating
 *   speaking     → wave bars + "Tap to interrupt" hint
 *   error        → red flash, auto-recovers
 *
 * When conversation mode is active (inConversation=true), a persistent teal ring
 * around the orb signals that the wake word is no longer needed.
 */

import { useState, useEffect } from "react";
import { Mic, MicOff, Brain, Volume2, Loader2, MessageCircle } from "lucide-react";
import type { VoiceStatus } from "@/hooks/useGlobalVoice";

interface Props {
  status:           VoiceStatus;
  transcript:       string;
  lastResponse:     string;
  inConversation:   boolean;
  onToggle:         () => void;
  onInterrupt:      () => void;
}

function WaveBars() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 16 }}>
      {[0.4, 0.7, 1, 0.7, 0.4].map((h, i) => (
        <div
          key={i}
          style={{
            width: 3, borderRadius: 2,
            background: "var(--color-accent)",
            height: `${h * 16}px`,
            animation: "voiceWave 0.8s ease-in-out infinite",
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

const STATUS_COLOR: Record<VoiceStatus, string> = {
  off:          "var(--color-text-muted)",
  wake:         "rgba(99,102,241,0.6)",
  listening:    "#22c55e",
  transcribing: "#f59e0b",
  thinking:     "#818cf8",
  speaking:     "var(--color-accent)",
  error:        "#ef4444",
};

const STATUS_LABEL: Record<VoiceStatus, string> = {
  off:          "Voice off",
  wake:         "Say: Hey Jazper",
  listening:    "Listening…",
  transcribing: "Transcribing…",
  thinking:     "Thinking…",
  speaking:     "Speaking…",
  error:        "Retrying…",
};

export function VoiceOrb({ status, transcript, lastResponse, inConversation, onToggle, onInterrupt }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showResponse,   setShowResponse]   = useState(false);

  useEffect(() => {
    if (!transcript) return;
    setShowTranscript(true);
    const t = setTimeout(() => setShowTranscript(false), 3500);
    return () => clearTimeout(t);
  }, [transcript]);

  useEffect(() => {
    if (!lastResponse || status === "speaking") return;
    setShowResponse(true);
    const t = setTimeout(() => setShowResponse(false), 5000);
    return () => clearTimeout(t);
  }, [lastResponse, status]);

  const active = status !== "off";
  const color  = STATUS_COLOR[status];

  function handleClick() {
    if (status === "speaking" || status === "thinking") {
      onInterrupt();
    } else {
      onToggle();
    }
  }

  const title = status === "speaking" || status === "thinking"
    ? "Tap to interrupt Jazper"
    : active
      ? `Voice ON — ${STATUS_LABEL[status]} (Ctrl+Shift+V)`
      : "Enable Voice Conversation Mode (Ctrl+Shift+V)";

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>

      {/* Conversation-mode persistent ring */}
      {inConversation && active && (
        <div style={{
          position:     "absolute",
          inset:        -8,
          borderRadius: "50%",
          border:       "1.5px solid #14b8a6",
          opacity:      0.45,
          pointerEvents: "none",
        }} />
      )}

      {/* Pulse ring for wake/listening */}
      {(status === "wake" || status === "listening") && (
        <div style={{
          position:     "absolute",
          inset:        -6,
          borderRadius: "50%",
          border:       `1.5px solid ${color}`,
          animation:    status === "listening"
            ? "voicePulseFast 0.7s ease-out infinite"
            : "voicePulseSlow 2s ease-in-out infinite",
          pointerEvents: "none",
        }} />
      )}

      {/* Orb button */}
      <button
        onClick={handleClick}
        title={title}
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          width:          30,
          height:         30,
          borderRadius:   "50%",
          border:         `1.5px solid ${active ? color : "var(--color-border)"}`,
          background:     active ? `${color}20` : "none",
          cursor:         "pointer",
          transition:     "all 0.2s ease",
          color:          color,
          flexShrink:     0,
        }}
      >
        {status === "off"          && <MicOff         size={13} />}
        {status === "wake"         && <Mic            size={13} />}
        {status === "listening"    && <Mic            size={13} />}
        {status === "transcribing" && <Loader2        size={13} style={{ animation: "spin 1s linear infinite" }} />}
        {status === "thinking"     && <Brain          size={13} />}
        {status === "speaking"     && <Volume2        size={13} />}
        {status === "error"        && <MicOff         size={13} />}
      </button>

      {/* Wave bars beside orb when speaking */}
      {status === "speaking" && (
        <div style={{ position: "absolute", left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" }}>
          <WaveBars />
        </div>
      )}

      {/* "Tap to interrupt" hint during speaking/thinking */}
      {(status === "speaking" || status === "thinking") && (
        <div style={{
          position:  "absolute",
          top:       "calc(100% + 28px)",
          right:     0,
          fontSize:  9,
          color:     color,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          opacity:   0.7,
          letterSpacing: "0.03em",
        }}>
          tap to interrupt
        </div>
      )}

      {/* Conversation-mode badge (replaces status label when in convo) */}
      {status === "wake" && inConversation && (
        <div style={{
          position:  "absolute",
          top:       "calc(100% + 10px)",
          right:     0,
          display:   "flex",
          alignItems: "center",
          gap:       3,
          fontSize:  9,
          color:     "#14b8a6",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}>
          <MessageCircle size={8} />
          conversation active
        </div>
      )}

      {/* Transcript bubble */}
      {showTranscript && transcript && (
        <div style={{
          position:    "absolute",
          top:         "calc(100% + 10px)",
          right:       0,
          background:  "var(--color-surface)",
          border:      "1px solid var(--color-border)",
          borderLeft:  `3px solid ${color}`,
          borderRadius: 7,
          padding:     "6px 10px",
          fontSize:    11,
          color:       "var(--color-text)",
          whiteSpace:  "nowrap",
          maxWidth:    300,
          overflow:    "hidden",
          textOverflow: "ellipsis",
          zIndex:      100,
          boxShadow:   "0 4px 16px rgba(0,0,0,0.4)",
          animation:   "fadeIn 0.15s ease",
        }}>
          <span style={{ color: "#64748b", marginRight: 4 }}>You:</span>
          {transcript}
        </div>
      )}

      {/* Response bubble — shown after speaking ends */}
      {showResponse && lastResponse && !showTranscript && (
        <div style={{
          position:    "absolute",
          top:         "calc(100% + 10px)",
          right:       0,
          background:  "var(--color-surface)",
          border:      "1px solid var(--color-border)",
          borderLeft:  "3px solid var(--color-accent)",
          borderRadius: 7,
          padding:     "6px 10px",
          fontSize:    11,
          color:       "var(--color-text)",
          whiteSpace:  "nowrap",
          maxWidth:    300,
          overflow:    "hidden",
          textOverflow: "ellipsis",
          zIndex:      100,
          boxShadow:   "0 4px 16px rgba(0,0,0,0.4)",
          animation:   "fadeIn 0.15s ease",
        }}>
          <span style={{ color: "var(--color-accent)", marginRight: 4 }}>Jazper:</span>
          {lastResponse}
        </div>
      )}

      {/* Generic status label */}
      {status !== "off" && status !== "wake" &&
       status !== "speaking" && status !== "thinking" &&
       !showTranscript && (
        <span style={{
          position:  "absolute",
          top:       "calc(100% + 10px)",
          right:     0,
          fontSize:  10,
          color:     color,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}>
          {STATUS_LABEL[status]}
        </span>
      )}

      <style>{`
        @keyframes voicePulseSlow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%       { opacity: 0.8; transform: scale(1.15); }
        }
        @keyframes voicePulseFast {
          0%   { opacity: 0.9; transform: scale(1); }
          100% { opacity: 0;   transform: scale(1.8); }
        }
        @keyframes voiceWave {
          0%, 100% { transform: scaleY(0.5); }
          50%       { transform: scaleY(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
