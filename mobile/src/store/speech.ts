import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { Message } from '@/db/chat';
import { splitForSpeechPipelined, voiceForText } from '@/voice/speech';

let runId = 0;
let currentSound: AudioPlayer | null = null;
const pendingFiles = new Set<File>();

function deleteFile(file: File): void {
  pendingFiles.delete(file);
  try {
    file.delete();
  } catch {
    // The cache file may already be gone.
  }
}

async function unloadCurrent(): Promise<void> {
  const sound = currentSound;
  currentSound = null;
  if (sound) {
    try {
      sound.pause();
    } catch {
      // Not playing.
    }
    try {
      sound.remove();
    } catch {
      // Already released.
    }
  }
  for (const file of [...pendingFiles]) deleteFile(file);
}

/** Downloads the audio for one chunk into a cache file. Runs while the previous chunk is still playing. */
async function fetchChunkFile(
  client: JasperClient,
  chunk: string,
  voice: string,
  credentials: { deviceId: string; deviceSecret: string }
): Promise<File> {
  let bytes: Uint8Array;
  try {
    bytes = await client.speakVoiceBytes(chunk, voice, credentials);
  } catch {
    // A dropped connection or a hiccup in the PC's speech service: one more try before giving up.
    bytes = await client.speakVoiceBytes(chunk, voice, credentials);
  }
  const file = new File(Paths.cache, `jasper-speech-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  pendingFiles.add(file);
  return file;
}

async function playFile(file: File, onPlaying: () => void): Promise<void> {
  const sound = createAudioPlayer({ uri: file.uri });
  currentSound = sound;
  onPlaying();

  await new Promise<void>((resolve, reject) => {
    sound.addListener('playbackStatusUpdate', (status) => {
      if (status.error) reject(new Error(status.error));
      else if (status.didJustFinish) resolve();
    });
    try {
      sound.play();
    } catch (err) {
      reject(err);
    }
  });

  if (currentSound === sound) {
    currentSound = null;
    try {
      sound.remove();
    } catch {
      // Already released.
    }
  }
  deleteFile(file);
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

    const chunks = splitForSpeechPipelined(message.text);
    if (chunks.length === 0) return;

    const token = ++runId;
    await unloadCurrent();
    const extraHeaders: Record<string, string> = {};
    if (credentials.cfAccessClientId) extraHeaders['CF-Access-Client-Id'] = credentials.cfAccessClientId;
    if (credentials.cfAccessClientSecret) {
      extraHeaders['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
    }
    const client = new JasperClient(credentials.baseUrl, accessToken ?? undefined, extraHeaders);
    const voice = voiceForText(message.from_slug || message.bot_slug, message.text);

    set({ messageId: message.id, loading: true, error: null });
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const creds = { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret };
      const start = (chunk: string): Promise<File> => {
        const p = fetchChunkFile(client, chunk, voice, creds);
        p.catch(() => undefined); // a stopped run must not leave an unhandled rejection behind
        return p;
      };
      // Pipeline: while chunk N plays, chunk N+1 is already downloading, so there is no silence between sentences.
      let next: Promise<File> | null = start(chunks[0]);
      for (let i = 0; i < chunks.length; i += 1) {
        if (token !== runId) return;
        const file = await (next as Promise<File>);
        next = i + 1 < chunks.length ? start(chunks[i + 1]) : null;
        if (token !== runId) return;
        await playFile(file, () => {
          if (token === runId && get().loading) set({ loading: false });
        });
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
