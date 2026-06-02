"use client";

import { useEffect, useRef, useCallback } from "react";

// Adaptive VAD thresholds — speech-start requires more energy than speech-stop (hysteresis)
const SPEECH_START_RATIO  = 3.5;   // must be Nx above noise floor to start
const SPEECH_STOP_RATIO   = 2.0;   // can drop to Nx above noise floor before stopping
const NOISE_SMOOTH        = 0.02;  // EMA coefficient for noise floor (slow adaptation)
const INITIAL_NOISE       = 0.008; // starting noise floor estimate
const SILENCE_MS          = 700;
const MIN_SPEECH_MS       = 300;

interface VADOptions {
  enabled: boolean;
  paused: boolean;
  onSpeechEnd: (blob: Blob) => void;
  onSpeechStart?: () => void;
}

export function useVAD({ enabled, paused, onSpeechEnd, onSpeechStart }: VADOptions) {
  const stateRef = useRef({
    ctx: null as AudioContext | null,
    analyser: null as AnalyserNode | null,
    recorder: null as MediaRecorder | null,
    stream: null as MediaStream | null,
    chunks: [] as Blob[],
    isSpeaking: false,
    silenceTimer: null as ReturnType<typeof setTimeout> | null,
    speechStart: 0,
    skipNext: false,
    rafId: null as number | null,
    active: false,
    noiseFloor: INITIAL_NOISE,  // adaptive noise estimate
  });

  const onSpeechEndRef = useRef(onSpeechEnd);
  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechEndRef.current = onSpeechEnd;
  onSpeechStartRef.current = onSpeechStart;

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const getRMS = useCallback(() => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Float32Array(s.analyser.frequencyBinCount);
    s.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((acc, v) => acc + v * v, 0) / data.length);
  }, []);

  const poll = useCallback(() => {
    const s = stateRef.current;
    if (!s.active) return;

    if (!pausedRef.current) {
      const rms = getRMS();

      if (!s.isSpeaking) {
        // Adapt noise floor only during silence (not while speaking)
        s.noiseFloor = s.noiseFloor * (1 - NOISE_SMOOTH) + rms * NOISE_SMOOTH;
      }

      const startThreshold = s.noiseFloor * SPEECH_START_RATIO;
      const stopThreshold  = s.noiseFloor * SPEECH_STOP_RATIO;

      if (!s.isSpeaking && rms > startThreshold) {
        if (s.silenceTimer) { clearTimeout(s.silenceTimer); s.silenceTimer = null; }
        if (s.recorder && s.recorder.state === "inactive") {
          s.isSpeaking = true;
          s.speechStart = Date.now();
          s.chunks = [];
          s.recorder.start();
          onSpeechStartRef.current?.();
        }
      } else if (s.isSpeaking) {
        if (rms > stopThreshold) {
          // Still above stop threshold — cancel any pending silence timer
          if (s.silenceTimer) { clearTimeout(s.silenceTimer); s.silenceTimer = null; }
        } else if (!s.silenceTimer) {
          s.silenceTimer = setTimeout(() => {
            if (!s.isSpeaking) return;
            s.isSpeaking = false;
            s.silenceTimer = null;
            const duration = Date.now() - s.speechStart;
            if (s.recorder && s.recorder.state === "recording") {
              if (duration < MIN_SPEECH_MS) s.skipNext = true;
              s.recorder.stop();
            }
          }, SILENCE_MS);
        }
      }
    }

    s.rafId = requestAnimationFrame(poll);
  }, [getRMS]);

  const start = useCallback(async () => {
    const s = stateRef.current;
    if (s.active) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) s.chunks.push(e.data); };
      recorder.onstop = () => {
        const skip = s.skipNext;
        s.skipNext = false;
        if (skip || s.chunks.length === 0) { s.chunks = []; return; }
        const blob = new Blob(s.chunks, { type: "audio/webm" });
        s.chunks = [];
        if (blob.size > 1000) onSpeechEndRef.current(blob);
      };

      s.ctx = ctx;
      s.analyser = analyser;
      s.recorder = recorder;
      s.stream = stream;
      s.active = true;
      s.noiseFloor = INITIAL_NOISE;
      poll();
    } catch {
      console.warn("Mic access denied — VAD disabled");
    }
  }, [poll]);

  const stop = useCallback(() => {
    const s = stateRef.current;
    s.active = false;
    if (s.rafId) cancelAnimationFrame(s.rafId);
    if (s.silenceTimer) clearTimeout(s.silenceTimer);
    if (s.recorder?.state !== "inactive") s.recorder?.stop();
    s.stream?.getTracks().forEach(t => t.stop());
    s.ctx?.close();
    s.ctx = null; s.analyser = null; s.recorder = null; s.stream = null;
    s.isSpeaking = false;
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return stop;
  }, [enabled, start, stop]);
}
