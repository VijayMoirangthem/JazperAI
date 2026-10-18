"use client";

/**
 * useGlobalVoice — page-level voice layer.
 *
 * Two phases:
 *   1. Wake phase  — SpeechRecognition listens for "Jazper" / "Jasper"
 *   2. Conversation loop — once triggered, stays in listen → converse → listen
 *      indefinitely (no wake word needed between turns)
 *
 * Interrupt: if the user speaks while Jazper is playing audio, the current
 * stream is cancelled, the audio stops, and the new utterance is processed.
 *
 * Conversation history (last 40 turns) is maintained in memory. It resets
 * when Voice-First Mode is toggled off.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useVAD } from "./useVAD";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type VoiceStatus =
  | "off"          // Voice-First Mode disabled
  | "wake"         // waiting for wake word
  | "listening"    // VAD recording — conversation turn in progress
  | "transcribing" // audio sent to Whisper
  | "thinking"     // waiting for first sentence from /converse
  | "speaking"     // playing audio queue
  | "error";       // transient error, auto-recovers

export interface GlobalVoiceState {
  status:               VoiceStatus;
  transcript:           string;
  lastResponse:         string;
  voiceFirstMode:       boolean;
  inConversation:       boolean;   // true once wake word fired this session
  toggleVoiceFirstMode: () => void;
  interrupt:            () => void;
  clearHistory:         () => void;
}

interface Callbacks {
  onNavigate:    (panel: string)                 => void;
  onChatMessage: (text: string, response: string) => void;
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf  = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const w    = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE"); w(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const ab  = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const dec = await ctx.decodeAudioData(ab);
  const mono = dec.getChannelData(0);
  await ctx.close();
  return encodeWav(mono, 16000);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGlobalVoice({ onNavigate, onChatMessage }: Callbacks): GlobalVoiceState {
  const [voiceFirstMode,  setVoiceFirstMode]  = useState(false);
  const [status,          setStatus]          = useState<VoiceStatus>("off");
  const [transcript,      setTranscript]      = useState("");
  const [lastResponse,    setLastResponse]    = useState("");
  const [inConversation,  setInConversation]  = useState(false);

  // Ref mirrors for use inside callbacks (avoid stale closures)
  const statusRef         = useRef<VoiceStatus>("off");
  const inConvRef         = useRef(false);
  const processingRef     = useRef(false);
  const speakingRef       = useRef(false);
  const voiceFirstRef     = useRef(false);
  const playingRef        = useRef(false);
  const sseCompleteRef    = useRef(false);

  // Audio queue — sentences arrive one by one from SSE
  const audioQueueRef     = useRef<string[]>([]);
  const audioRef          = useRef<HTMLAudioElement | null>(null);

  // SSE stream control
  const abortRef          = useRef<AbortController | null>(null);
  const convIdRef         = useRef<string>("");

  // Conversation history (persists across turns, resets on mode-off)
  const historyRef        = useRef<Array<{ role: string; content: string }>>([]);

  // Wake word (typed as any — browser SpeechRecognition API not in standard TS lib)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeRecRef        = useRef<any | null>(null);

  // Keep refs in sync
  const setStatusBoth = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const setInConvBoth = useCallback((v: boolean) => {
    inConvRef.current = v;
    setInConversation(v);
  }, []);

  voiceFirstRef.current = voiceFirstMode;

  // ── Cancel backend stream + stop audio ─────────────────────────────────────
  const cancelAndStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const cid = convIdRef.current;
    if (cid) {
      convIdRef.current = "";
      fetch(`${API}/api/voice/converse/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conv_id: cid }),
      }).catch(() => {});
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    audioQueueRef.current  = [];
    speakingRef.current    = false;
    processingRef.current  = false;
  }, []);

  // ── Public interrupt — also callable from VoiceOrb click ───────────────────
  const interrupt = useCallback(() => {
    if (statusRef.current !== "speaking" && statusRef.current !== "thinking") return;
    cancelAndStop();
    setStatusBoth("listening");
  }, [cancelAndStop, setStatusBoth]);

  // ── Play next sentence in queue ────────────────────────────────────────────
  const playNext = useCallback(() => {
    const b64 = audioQueueRef.current.shift();
    if (!b64) {
      playingRef.current = false;
      // Only transition to listening when SSE stream is fully done.
      // If SSE is still running, more audio may arrive and will kick playback via !playingRef check.
      if (sseCompleteRef.current) {
        speakingRef.current = false;
        if (inConvRef.current && voiceFirstRef.current) {
          setStatusBoth("listening");
        } else {
          setStatusBoth("wake");
        }
      }
      return;
    }
    playingRef.current = true;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = `data:audio/mpeg;base64,${b64}`;
    audioRef.current.onended = () => { playingRef.current = false; playNext(); };
    audioRef.current.onerror = () => { playingRef.current = false; playNext(); };
    audioRef.current.play().catch(() => { playingRef.current = false; playNext(); });
  }, [setStatusBoth]);

  // ── Process a recorded utterance ───────────────────────────────────────────
  const handleUtterance = useCallback(async (blob: Blob) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatusBoth("transcribing");

    try {
      // 1. STT
      const wav  = await blobToWav(blob);
      const form = new FormData();
      form.append("audio", wav, "utterance.wav");
      const trRes = await fetch(`${API}/api/voice/transcribe`, { method: "POST", body: form });
      if (!trRes.ok) throw new Error("transcribe failed");
      const { text, empty } = await trRes.json();

      if (empty || !text?.trim()) {
        processingRef.current = false;
        setStatusBoth(inConvRef.current ? "listening" : "wake");
        return;
      }
      setTranscript(text);
      setStatusBoth("thinking");

      // 2. Navigation fast-path (keyword match, no LLM cost)
      const navRes = await fetch(`${API}/api/voice/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, speak: false }),
      });
      if (navRes.ok) {
        const cmd = await navRes.json();
        if (cmd.type === "navigate") {
          onNavigate(cmd.target);
          processingRef.current = false;
          setStatusBoth(inConvRef.current ? "listening" : "wake");
          return;
        }
      }

      // 3. Add user turn to history
      historyRef.current.push({ role: "user", content: text });
      if (historyRef.current.length > 40) historyRef.current = historyRef.current.slice(-40);

      // 4. Stream conversation response
      const convId = crypto.randomUUID();
      convIdRef.current  = convId;
      const abort        = new AbortController();
      abortRef.current   = abort;
      speakingRef.current  = true;
      playingRef.current   = false;
      sseCompleteRef.current = false;
      audioQueueRef.current = [];
      setStatusBoth("speaking");

      const res = await fetch(`${API}/api/voice/converse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          history: historyRef.current.slice(0, -1), // exclude the turn just added
          voice: "en-US-GuyNeural",
          conv_id: convId,
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error("converse failed");

      let fullText   = "";
      const reader   = res.body.getReader();
      const decoder  = new TextDecoder();
      let sseBuffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);

          if (payload.startsWith("[SENTENCE]")) {
            const data = JSON.parse(payload.slice(10));
            if (data.audio_b64) {
              audioQueueRef.current.push(data.audio_b64);
              // Always kick playback if nothing is currently playing (handles gap between sentences)
              if (!playingRef.current) { playNext(); }
            }
          } else if (payload.startsWith("[DONE]")) {
            const data = JSON.parse(payload.slice(6));
            fullText = data.full_text || "";
          }
          // [CANCELLED] and [ERROR] handled by stream end / catch
        }
      }

      // 5. Save assistant turn to history
      if (fullText) {
        historyRef.current.push({ role: "assistant", content: fullText });
        setLastResponse(fullText);
        onChatMessage(text, fullText);
      }

      // SSE stream is done — mark complete so playNext can transition state when queue drains
      sseCompleteRef.current = true;
      if (audioQueueRef.current.length > 0 && !playingRef.current) {
        // Items queued but not playing (arrived right as last sentence ended)
        playNext();
      } else if (audioQueueRef.current.length === 0 && !playingRef.current) {
        // Nothing queued, nothing playing — transition immediately
        speakingRef.current = false;
        if (inConvRef.current && voiceFirstRef.current) {
          setStatusBoth("listening");
        } else {
          setStatusBoth("wake");
        }
      }

    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        // Interrupted — interrupt() already set the correct status
      } else {
        console.warn("GlobalVoice error:", err);
        setStatusBoth("error");
        setTimeout(() => {
          if (!voiceFirstRef.current) return;
          setStatusBoth(inConvRef.current ? "listening" : "wake");
        }, 2000);
      }
    } finally {
      processingRef.current = false;
      abortRef.current      = null;
    }
  }, [onNavigate, onChatMessage, playNext, setStatusBoth]);

  // ── VAD ─────────────────────────────────────────────────────────────────────
  // Active during "listening" (capture turns) and "speaking" (detect interrupt).
  useVAD({
    enabled: voiceFirstMode && (status === "listening" || status === "speaking"),
    paused:  false,
    onSpeechStart: () => {
      // User spoke while Jazper was talking — interrupt immediately
      if (statusRef.current === "speaking" && speakingRef.current) {
        cancelAndStop();
        setStatusBoth("listening");
        // Don't set processingRef here — handleUtterance will set it when blob arrives
      }
    },
    onSpeechEnd: handleUtterance,
  });

  // ── Wake word via SpeechRecognition ─────────────────────────────────────────
  useEffect(() => {
    if (!voiceFirstMode) {
      wakeRecRef.current?.stop();
      wakeRecRef.current = null;
      cancelAndStop();
      historyRef.current = [];
      setInConvBoth(false);
      setStatusBoth("off");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec: (new () => any) | undefined =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      // No SpeechRecognition — go straight into conversation mode
      setInConvBoth(true);
      setStatusBoth("listening");
      return;
    }

    setStatusBoth("wake");

    const rec = new SpeechRec();
    rec.continuous       = true;
    rec.interimResults   = false;
    rec.lang             = "en-US";
    rec.maxAlternatives  = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      if (!last.isFinal) return;
      const said = last[0].transcript.toLowerCase();
      if (
        (said.includes("jazper") || said.includes("jasper")) &&
        !processingRef.current && !speakingRef.current
      ) {
        setInConvBoth(true);
        setStatusBoth("listening");
      }
    };
    rec.onerror = () => { /* onend fires after every error and handles restart */ };
    rec.onend   = () => { if (voiceFirstRef.current) try { rec.start(); } catch { /* race — already restarted */ } };
    rec.start();
    wakeRecRef.current = rec;

    return () => { rec.stop(); wakeRecRef.current = null; };
  }, [voiceFirstMode, setStatusBoth, setInConvBoth, cancelAndStop]);

  // ── Keyboard shortcut Ctrl+Shift+V ──────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "V") {
        e.preventDefault();
        setVoiceFirstMode(m => !m);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleVoiceFirstMode = useCallback(() => setVoiceFirstMode(m => !m), []);
  const clearHistory          = useCallback(() => { historyRef.current = []; }, []);

  return {
    status,
    transcript,
    lastResponse,
    voiceFirstMode,
    inConversation,
    toggleVoiceFirstMode,
    interrupt,
    clearHistory,
  };
}
