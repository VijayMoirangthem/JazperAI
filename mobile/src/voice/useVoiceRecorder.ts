/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { transcribeUri } from './transcribe';

export interface VoiceRecorder {
  recording: boolean;
  seconds: number;
  /** Smoothed input level 0..1 for the waveform. */
  level: number;
  transcribing: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  clearError: () => void;
}

export function useVoiceRecorder(onText: (text: string) => void): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearMeter = useCallback(() => {
    if (meterRef.current) {
      clearInterval(meterRef.current);
      meterRef.current = null;
    }
    setLevel(0);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission is needed for a voice note.');
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const active = new AudioModule.AudioRecorder({});
      await active.prepareToRecordAsync({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
      active.record();
      recordingRef.current = active;
      setRecording(true);
      setSeconds(0);
      clearTimer();
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
      let smooth = 0.15;
      meterRef.current = setInterval(() => {
        const reader = active as unknown as { getStatus?: () => { metering?: number } };
        const db = reader.getStatus?.().metering;
        // metering is in dB (about -60 quiet .. 0 loud); without it fall back to a gentle pulse.
        const target = typeof db === 'number' ? Math.min(1, Math.max(0, (db + 55) / 55)) : 0.25 + Math.random() * 0.4;
        smooth = smooth * 0.55 + target * 0.45;
        setLevel(smooth);
      }, 90);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording');
    }
  }, [clearTimer]);

  const cleanup = useCallback(async (): Promise<string | null> => {
    clearTimer();
    clearMeter();
    setRecording(false);
    const active = recordingRef.current;
    recordingRef.current = null;
    if (!active) return null;

    let uri: string | null = null;
    try {
      await active.stop();
      uri = active.uri;
    } catch {
      // The recording may already have stopped.
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      // Audio mode is best effort.
    }
    return uri;
  }, [clearTimer, clearMeter]);

  const stop = useCallback(async () => {
    const uri = await cleanup();
    if (!uri) return;

    setTranscribing(true);
    try {
      const { credentials, accessToken } = useAuth.getState();
      if (!credentials) {
        throw new Error('This phone is not paired with a desktop.');
      }
      const client = new JasperClient(credentials.baseUrl, accessToken ?? undefined);
      const text = await transcribeUri(uri, (audio) =>
        client.transcribeVoice(audio, {
          deviceId: credentials.deviceId,
          deviceSecret: credentials.deviceSecret,
        })
      );
      if (text.trim()) onText(text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transcribe the voice note');
    } finally {
      setTranscribing(false);
    }
  }, [cleanup, onText]);

  const cancel = useCallback(async () => {
    await cleanup();
  }, [cleanup]);

  useEffect(
    () => () => {
      clearTimer();
      void recordingRef.current?.stop().catch(() => undefined);
    },
    [clearTimer]
  );

  const clearError = useCallback(() => setError(null), []);

  return { recording, seconds, level, transcribing, error, start, stop, cancel, clearError };
}
