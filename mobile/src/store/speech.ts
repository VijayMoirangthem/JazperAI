import { create } from 'zustand';
import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { Message } from '@/db/chat';
import { splitForSpeech, voiceForBot } from '@/voice/speech';

let runId = 0;
let currentSound: Audio.Sound | null = null;
let currentFile: File | null = null;

async function unloadCurrent(): Promise<void> {
  const sound = currentSound;
  currentSound = null;
  if (sound) {
    try {
      await sound.stopAsync();
    } catch {
      // Not playing.
    }
    try {
      await sound.unloadAsync();
    } catch {
      // Already unloaded.
    }
  }

  const file = currentFile;
  currentFile = null;
  if (file) {
    try {
      file.delete();
    } catch {
      // The cache file may already be gone.
    }
  }
}

async function playChunk(
  client: JasperClient,
  chunk: string,
  voice: string,
  credentials: { deviceId: string; deviceSecret: string },
  onPlaying: () => void
): Promise<void> {
  const blob = await client.speakVoice(chunk, voice, credentials);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const file = new File(Paths.cache, `jasper-speech-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  currentFile = file;

  const { sound } = await Audio.Sound.createAsync({ uri: file.uri });
  currentSound = sound;
  onPlaying();

  await new Promise<void>((resolve, reject) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) {
        if (status.error) reject(new Error(status.error));
        return;
      }
      if (status.didJustFinish) resolve();
    });
    sound.playAsync().catch(reject);
  });

  await unloadCurrent();
}

interface SpeechState {
  messageId: number | null;
  loading: boolean;
  error: string | null;
  speak: (message: Message) => Promise<void>;
  stop: () => Promise<void>;
  clearError: () => void;
}

export const useSpeech = create<SpeechState>()((set, get) => ({
  messageId: null,
  loading: false,
  error: null,

  speak: async (message: Message) => {
    const { credentials, accessToken } = useAuth.getState();
    if (!credentials) {
      set({ error: 'This phone is not paired with a desktop.' });
      return;
    }

    const chunks = splitForSpeech(message.text);
    if (chunks.length === 0) return;

    const token = ++runId;
    await unloadCurrent();
    const extraHeaders: Record<string, string> = {};
    if (credentials.cfAccessClientId) extraHeaders['CF-Access-Client-Id'] = credentials.cfAccessClientId;
    if (credentials.cfAccessClientSecret) {
      extraHeaders['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
    }
    const client = new JasperClient(credentials.baseUrl, accessToken ?? undefined, extraHeaders);
    const voice = voiceForBot(message.from_slug || message.bot_slug);

    set({ messageId: message.id, loading: true, error: null });
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      for (const chunk of chunks) {
        if (token !== runId) return;
        await playChunk(
          client,
          chunk,
          voice,
          { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret },
          () => {
            if (token === runId && get().loading) set({ loading: false });
          }
        );
        if (token !== runId) return;
      }
      if (token === runId) set({ messageId: null, loading: false });
    } catch (err) {
      if (token === runId) {
        await unloadCurrent();
        set({
          messageId: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not read the message aloud',
        });
      }
    }
  },

  stop: async () => {
    runId += 1;
    await unloadCurrent();
    set({ messageId: null, loading: false });
  },

  clearError: () => set({ error: null }),
}));
