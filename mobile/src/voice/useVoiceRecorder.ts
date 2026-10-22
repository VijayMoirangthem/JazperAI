import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { transcribeUri } from './transcribe';

export interface VoiceRecorder {
  recording: boolean;
  seconds: number;
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
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission is needed for a voice note.');
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: active } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = active;
      setRecording(true);
      setSeconds(0);
      clearTimer();
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording');
    }
  }, [clearTimer]);

  const cleanup = useCallback(async (): Promise<string | null> => {
    clearTimer();
    setRecording(false);
    const active = recordingRef.current;
    recordingRef.current = null;
    if (!active) return null;

    const uri = active.getURI();
    try {
      await active.stopAndUnloadAsync();
    } catch {
      // The recording may already have stopped.
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    } catch {
      // Audio mode is best effort.
    }
    return uri;
  }, [clearTimer]);

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
      void recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
    },
    [clearTimer]
  );

  const clearError = useCallback(() => setError(null), []);

  return { recording, seconds, transcribing, error, start, stop, cancel, clearError };
}
