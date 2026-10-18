"use client";

import { useEffect, useRef, useState, useCallback, type RefObject } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ConvState = "idle" | "listening" | "processing" | "thinking" | "speaking" | "error" | "chaining";

export interface Turn {
  id:      string;
  role:    "user" | "assistant";
  content: string;
}

export interface ChainStep {
  index:  number;
  step:   string;
  status: "thinking" | "running" | "done" | "error";
  result?: string;
}

export interface ConversationHandle {
  state:        ConvState;
  stateRef:     RefObject<ConvState>;
  amplitudeRef: RefObject<number>;
  transcript:   string;
  response:     string;
  history:      Turn[];
  chainSteps:   ChainStep[];
  interrupt:    () => void;
  clearHistory: () => void;
}

// ── VAD tuning ────────────────────────────────────────────────────────────────
const SILENCE_MS         = 500;   // ms of quiet after speech before committing
const MIN_SPEECH_MS      = 400;   // discard clips shorter than this (filters noise bursts)
const NOISE_SMOOTH       = 0.01;  // slow EMA — let the noise floor stabilise properly
const WARMUP_MS          = 1500;  // ignore triggers for this long after mic starts
const SPEECH_START_RATIO = 6.0;   // high threshold — only real voiced speech, not room noise
const SPEECH_STOP_RATIO  = 2.5;   // stop threshold (hysteresis)
const INTERRUPT_RATIO    = 8.0;   // very high during speaking — prevents JBL echo triggers

// ── Audio helpers ─────────────────────────────────────────────────────────────

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8  = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return buf;
}

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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceConversation(enabled: boolean): ConversationHandle {
  // React state — triggers re-renders for UI labels/transcript
  const [state,      setState]      = useState<ConvState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response,   setResponse]   = useState("");
  const [history,    setHistory]    = useState<Turn[]>([]);
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([]);

  // Refs — mutated directly, no re-renders
  const stateRef       = useRef<ConvState>("idle");
  const amplitudeRef   = useRef<number>(0);

  // Audio infrastructure
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const micStreamRef   = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micDataRef     = useRef<Float32Array<ArrayBuffer> | null>(null);
  const spkAnalyserRef = useRef<AnalyserNode | null>(null);
  const spkDataRef     = useRef<Float32Array<ArrayBuffer> | null>(null);
  const currentSrcRef  = useRef<AudioBufferSourceNode | null>(null);

  // Conversation buffers
  const historyRef     = useRef<Turn[]>([]);
  const abortRef       = useRef<AbortController | null>(null);
  const convIdRef      = useRef<string>("");
  const audioQueueRef  = useRef<{ text: string; b64: string }[]>([]);
  const playingRef     = useRef(false);
  const rafRef         = useRef<number>(0);

  // VAD mutable state — lives outside React to avoid stale closures
  const vadRef = useRef({
    isSpeaking:   false,
    speechStart:  0,
    silenceStart: 0,
    noiseFloor:   0.01,
    micStartedAt: 0,        // timestamp when mic was first opened (for warmup)
    recorder:     null as MediaRecorder | null,
    chunks:       [] as Blob[],
  });

  const setStateBoth = useCallback((s: ConvState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // ── Cancel backend stream + stop audio ──────────────────────────────────────
  const cancelAndStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const cid = convIdRef.current;
    if (cid) {
      convIdRef.current = "";
      fetch(`${API}/api/voice/converse/cancel`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ conv_id: cid }),
      }).catch(() => {});
    }

    if (currentSrcRef.current) {
      try { currentSrcRef.current.stop(); } catch { /* already stopped */ }
      currentSrcRef.current = null;
    }
    audioQueueRef.current = [];
    playingRef.current    = false;
  }, []);

  // ── Play TTS sentences through AudioContext speakerAnalyser ─────────────────
  const playNext = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;

    const item = audioQueueRef.current.shift();
    if (!item) {
      playingRef.current = false;
      if (stateRef.current === "speaking") setStateBoth("listening");
      return;
    }

    playingRef.current = true;
    try {
      const arrayBuf  = b64ToArrayBuffer(item.b64);
      const audioBuf  = await ctx.decodeAudioData(arrayBuf);

      if ((ctx.state as string) === "closed") return;

      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      currentSrcRef.current = src;

      if (spkAnalyserRef.current) {
        src.connect(spkAnalyserRef.current);
        // spkAnalyser is already connected to destination during setup
      } else {
        src.connect(ctx.destination);
      }

      src.onended = () => { currentSrcRef.current = null; playNext(); };
      src.start();
    } catch {
      playNext(); // skip broken sentence, try next
    }
  }, [setStateBoth]);

  // ── STT → LLM → TTS pipeline ────────────────────────────────────────────────
  const handleUtterance = useCallback(async (blob: Blob) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") return;

    setStateBoth("processing");

    try {
      // Decode to 16 kHz mono WAV for Whisper
      const decCtx  = new AudioContext({ sampleRate: 16000 });
      const decoded = await decCtx.decodeAudioData(await blob.arrayBuffer());
      const mono    = decoded.getChannelData(0);
      await decCtx.close();
      const wav = encodeWav(mono, 16000);

      // STT
      const form = new FormData();
      form.append("audio", wav, "utt.wav");
      const trRes = await fetch(`${API}/api/voice/transcribe`, { method: "POST", body: form });
      if (!trRes.ok) throw new Error("transcribe failed");
      const { text, empty } = await trRes.json();

      if (empty || !text?.trim()) {
        setStateBoth("listening");
        return;
      }

      setTranscript(text);
      setStateBoth("thinking");

      const userTurn: Turn = { id: crypto.randomUUID(), role: "user", content: text };
      historyRef.current = [...historyRef.current, userTurn].slice(-40);
      setHistory([...historyRef.current]);

      // Stream conversation
      const convId   = crypto.randomUUID();
      convIdRef.current = convId;
      const abort    = new AbortController();
      abortRef.current = abort;
      audioQueueRef.current = [];
      setStateBoth("speaking");

      const res = await fetch(`${API}/api/voice/converse`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          text,
          history: historyRef.current.slice(0, -1).map(t => ({ role: t.role, content: t.content })),
          voice:   "en-US-GuyNeural",
          conv_id: convId,
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error("converse failed");

      let fullText   = "";
      let firstAudio = true;
      const reader   = res.body.getReader();
      const decoder  = new TextDecoder();
      let   sseBuf   = "";

      // Reset chain steps for new message
      setChainSteps([]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const lines = sseBuf.split("\n\n");
        sseBuf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);

          if (payload.startsWith("[SENTENCE]")) {
            const data = JSON.parse(payload.slice(10));
            if (data.audio_b64) {
              audioQueueRef.current.push({ text: data.text, b64: data.audio_b64 });
              if (firstAudio) { firstAudio = false; playNext(); }
            }
          } else if (payload.startsWith("[DONE]")) {
            const data = JSON.parse(payload.slice(6));
            fullText = data.full_text || "";

          // ── Phase 8D: chain events ─────────────────────────────────────────
          } else if (payload.startsWith("[CHAIN_PLAN]")) {
            setStateBoth("chaining");
            try {
              const data = JSON.parse(payload.slice(12));
              const steps: ChainStep[] = (data.steps || []).map((s: string, i: number) => ({
                index: i, step: s, status: "thinking" as const,
              }));
              setChainSteps(steps);
            } catch { /* ignore parse errors */ }

          } else if (payload.startsWith("[CHAIN_STEP]")) {
            try {
              const data = JSON.parse(payload.slice(12));
              setChainSteps(prev => prev.map(s =>
                s.index === data.index
                  ? { ...s, status: data.status, result: data.result }
                  : s
              ));
            } catch { /* ignore */ }

          } else if (payload.startsWith("[APPROVAL_NEEDED]")) {
            setStateBoth("thinking");

          } else if (payload.startsWith("[CHAIN_ERROR]")) {
            setStateBoth("error");
            setChainSteps(prev => prev.map(s =>
              s.status === "thinking" || s.status === "running"
                ? { ...s, status: "error" as const }
                : s
            ));
          }
        }
      }

      if (fullText) {
        const asstTurn: Turn = { id: crypto.randomUUID(), role: "assistant", content: fullText };
        historyRef.current = [...historyRef.current, asstTurn].slice(-40);
        setHistory([...historyRef.current]);
        setResponse(fullText);
      }

      if (audioQueueRef.current.length > 0 && !playingRef.current) playNext();

    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        console.warn("useVoiceConversation error:", err);
        setStateBoth("error");
        setTimeout(() => {
          if (stateRef.current === "error") setStateBoth("listening");
        }, 2000);
      }
    }
  }, [playNext, setStateBoth]);

  // ── Public interrupt ─────────────────────────────────────────────────────────
  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking" && stateRef.current !== "thinking") return;
    cancelAndStop();
    setStateBoth("listening");
  }, [cancelAndStop, setStateBoth]);

  // ── Combined VAD + amplitude animation loop (requestAnimationFrame) ──────────
  const vadLoop = useCallback(() => {
    const v  = vadRef.current;
    const st = stateRef.current;

    // ── Mic RMS ──────────────────────────────────────────────────────────────
    let micRMS = 0;
    if (micAnalyserRef.current && micDataRef.current) {
      micAnalyserRef.current.getFloatTimeDomainData(micDataRef.current);
      let sum = 0;
      for (const s of micDataRef.current) sum += s * s;
      micRMS = Math.sqrt(sum / micDataRef.current.length);
    }

    // ── Speaker RMS ──────────────────────────────────────────────────────────
    let spkRMS = 0;
    if (spkAnalyserRef.current && spkDataRef.current) {
      spkAnalyserRef.current.getFloatTimeDomainData(spkDataRef.current);
      let sum = 0;
      for (const s of spkDataRef.current) sum += s * s;
      spkRMS = Math.sqrt(sum / spkDataRef.current.length);
    }

    // ── Amplitude for sphere ──────────────────────────────────────────────────
    let targetAmp = 0;
    const now = Date.now();
    if      (st === "listening")  targetAmp = Math.min(micRMS * 7, 1);
    else if (st === "speaking")   targetAmp = Math.min(spkRMS * 5, 1);
    else if (st === "thinking")   targetAmp = 0.4 + 0.2  * Math.sin(now * 0.003);
    else if (st === "processing") targetAmp = 0.25 + 0.15 * Math.sin(now * 0.006);
    amplitudeRef.current = amplitudeRef.current * 0.75 + targetAmp * 0.25;

    // ── VAD ────────────────────────────────────────────────────────────────────
    // Noise floor adapts in every state so it's ready when we enter listening.
    // Speech detection only fires in listening/speaking to avoid interfering with
    // processing/thinking states.
    if (!v.isSpeaking) {
      v.noiseFloor = v.noiseFloor * (1 - NOISE_SMOOTH) + micRMS * NOISE_SMOOTH;
      v.noiseFloor = Math.max(v.noiseFloor, 0.001);
    }

    if (st === "listening" || st === "speaking") {
      const warmedUp   = (now - v.micStartedAt) > WARMUP_MS;
      const startRatio = st === "speaking" ? INTERRUPT_RATIO : SPEECH_START_RATIO;

      if (!v.isSpeaking && warmedUp && micRMS > v.noiseFloor * startRatio) {
        // ── Speech start ────────────────────────────────────────────────────
        v.isSpeaking   = true;
        v.speechStart  = now;
        v.silenceStart = 0;
        v.chunks       = [];

        if (micStreamRef.current) {
          try {
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
              ? "audio/webm;codecs=opus"
              : "audio/webm";
            const rec = new MediaRecorder(micStreamRef.current, { mimeType });
            rec.ondataavailable = (e) => { if (e.data.size > 0) v.chunks.push(e.data); };
            rec.onstop = () => {
              const dur = Date.now() - v.speechStart;  // Date.now() at stop time, not capture time
              if (dur >= MIN_SPEECH_MS && v.chunks.length > 0) {
                const b = new Blob(v.chunks, { type: "audio/webm" });
                if (b.size > 500) handleUtterance(b);
              }
              v.chunks = [];
            };
            rec.start(50);
            v.recorder = rec;
          } catch { /* mic unavailable */ }
        }

        // Interrupt Jazper if he was speaking
        if (st === "speaking") {
          cancelAndStop();
          stateRef.current = "processing";
          setState("processing");
        }

      } else if (v.isSpeaking) {
        if (micRMS > v.noiseFloor * SPEECH_STOP_RATIO) {
          v.silenceStart = 0;
        } else {
          if (v.silenceStart === 0) v.silenceStart = now;
          if (now - v.silenceStart > SILENCE_MS) {
            v.isSpeaking   = false;
            v.silenceStart = 0;
            if (v.recorder?.state === "recording") v.recorder.stop();
            v.recorder = null;
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(vadLoop);
  }, [handleUtterance, cancelAndStop]);

  // ── Lifecycle — set up AudioContext + mic when enabled ───────────────────────
  useEffect(() => {
    if (!enabled) return;

    let destroyed = false;
    let ctx: AudioContext | null = null;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
          },
        });
        if (destroyed) { stream.getTracks().forEach(t => t.stop()); return; }

        ctx = new AudioContext({ sampleRate: 16000 });
        if (ctx.state === "suspended") await ctx.resume();

        // Mic → analyser (not connected to destination — no echo)
        const micAna = ctx.createAnalyser();
        micAna.fftSize = 512;
        micAna.smoothingTimeConstant = 0.85;
        ctx.createMediaStreamSource(stream).connect(micAna);

        // Speaker analyser — permanently connected to destination
        const spkAna = ctx.createAnalyser();
        spkAna.fftSize = 512;
        spkAna.smoothingTimeConstant = 0.8;
        spkAna.connect(ctx.destination);

        audioCtxRef.current    = ctx;
        micStreamRef.current   = stream;
        micAnalyserRef.current = micAna;
        micDataRef.current     = new Float32Array(micAna.frequencyBinCount) as Float32Array<ArrayBuffer>;
        spkAnalyserRef.current = spkAna;
        spkDataRef.current     = new Float32Array(spkAna.frequencyBinCount) as Float32Array<ArrayBuffer>;

        vadRef.current.noiseFloor   = 0.01;
        vadRef.current.isSpeaking   = false;
        vadRef.current.micStartedAt = Date.now();

        setStateBoth("listening");
        rafRef.current = requestAnimationFrame(vadLoop);
      } catch (err) {
        console.warn("VoiceConversation: mic access failed:", err);
        if (!destroyed) setStateBoth("error");
      }
    }

    setup();

    return () => {
      destroyed = true;
      cancelAnimationFrame(rafRef.current);
      cancelAndStop();

      const v = vadRef.current;
      if (v.recorder?.state === "recording") { try { v.recorder.stop(); } catch { /**/ } }
      v.recorder    = null;
      v.isSpeaking  = false;

      micStreamRef.current?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      micStreamRef.current   = null;
      micAnalyserRef.current = null;
      spkAnalyserRef.current = null;
      audioCtxRef.current    = null;

      setStateBoth("idle");
    };
  }, [enabled, vadLoop, cancelAndStop, setStateBoth]);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setHistory([]);
  }, []);

  return { state, stateRef, amplitudeRef, transcript, response, history, chainSteps, interrupt, clearHistory };
}
