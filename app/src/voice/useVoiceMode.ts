import { useCallback, useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { encodeWav } from "@/voice/audio";
import type { Speaker } from "@/voice/speaker";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ASSETS = `${import.meta.env.BASE_URL}vad/`;

export type VoiceState = "off" | "starting" | "listening" | "transcribing" | "error";
export interface Timing { speechEnd: number; transcript: number }

/**
 * Hands-free voice conversation: Silero VAD (in the browser, ONNX) detects when you start and stop speaking; the clip is transcribed by
 * the backend (/api/voice/transcribe: Groq Whisper with a local fallback). Speaking over the assistant is a barge-in: playback stops and
 * `onBargeIn` lets the caller cancel the running reply.
 */
export function useVoiceMode(opts: { speaker: Speaker; onBargeIn: () => void; onUtterance: (text: string, t: Timing) => void }) {
  const [state, setState] = useState<VoiceState>("off");
  const [error, setError] = useState("");
  const vad = useRef<MicVAD | null>(null);
  const o = useRef(opts);
  o.current = opts;

  const stop = useCallback(async () => {
    await vad.current?.destroy();
    vad.current = null;
    o.current.speaker.stop();
    setState("off");
  }, []);

  const start = useCallback(async () => {
    setState("starting"); setError("");
    try {
      vad.current = await MicVAD.new({
        model: "v5",
        baseAssetPath: ASSETS,
        onnxWASMBasePath: ASSETS,
        redemptionMs: 700, // end of speech after 0.7 s of silence: snappy without cutting sentences
        onSpeechStart: () => {
          if (o.current.speaker.active) { o.current.speaker.stop(); o.current.onBargeIn(); } // barge-in
        },
        onSpeechEnd: async (audio: Float32Array) => {
          const speechEnd = Date.now();
          setState("transcribing");
          try {
            const fd = new FormData();
            fd.append("audio", new File([encodeWav(audio) as BlobPart], "speech.wav", { type: "audio/wav" }));
            const r = await fetch(`${API}/api/voice/transcribe`, { method: "POST", body: fd });
            const text: string = (await r.json()).text ?? "";
            if (text.trim()) o.current.onUtterance(text.trim(), { speechEnd, transcript: Date.now() });
          } catch { /* transient: keep listening */ }
          setState("listening");
        },
      });
      await vad.current.start();
      setState("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  useEffect(() => () => { void vad.current?.destroy(); }, []);

  return { state, error, enabled: state !== "off" && state !== "error", toggle: () => (state === "off" || state === "error" ? start() : stop()) };
}
