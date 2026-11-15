import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { Message } from '@/db/chat';
import { splitForSpeech, splitForSpeechPipelined, voiceForText } from '@/voice/speech';
import { LiveSplitter, cleanForSpeech } from '@/voice/liveSplitter';
import { SpeechPipeline } from '@/voice/pipeline';

// One spoken reply at a time. A reply can be spoken after it is complete (the Speak button) or WHILE it is still being written (voice
// conversation): sentences are handed to the pipeline as they complete, and the pipeline downloads the next ones during playback.

interface Run {
  token: number;
  pipeline: SpeechPipeline<File>;
  slug: string;
  voice: string;
  splitter: LiveSplitter | null; // set for live (streaming) runs
}

let runCounter = 0;
let current: Run | null = null;
let currentSound: AudioPlayer | null = null;
const pendingFiles = new Set<File>();
const MAX_CHUNK = 500; // the PC refuses longer pieces (600)

function deleteFile(file: File): void {
  pendingFiles.delete(file);
  try {
    file.delete();
  } catch {
    // The cache file may already be gone.
  }
}

function releaseSound(sound: AudioPlayer | null): void {
  if (!sound) return;
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

/** Ends the current run: stops the sound, cancels downloads, deletes cache files. */
function stopCurrent(): void {
  const run = current;
  current = null;
  run?.pipeline.stop();
  releaseSound(currentSound);
  currentSound = null;
  for (const file of [...pendingFiles]) deleteFile(file);
}

async function fetchChunkFile(client: JasperClient, text: string, voice: string, credentials: { deviceId: string; deviceSecret: string }): Promise<File> {
  let bytes: Uint8Array;
  try {
    bytes = await client.speakVoiceBytes(text, voice, credentials);
  } catch {
    // A dropped connection or a hiccup in the PC's speech service: one more try before giving up.
    bytes = await client.speakVoiceBytes(text, voice, credentials);
  }
  const file = new File(Paths.cache, `jasper-speech-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
  file.create({ overwrite: true, intermediates: true });
  await file.write(bytes);
  pendingFiles.add(file);
  return file;
}

async function playFile(file: File, onStart: () => void, signal: { stopped: Promise<void> }): Promise<void> {
  const sound = createAudioPlayer({ uri: file.uri });
  currentSound = sound;
  onStart();
  let subscription: { remove: () => void } | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      subscription = sound.addListener('playbackStatusUpdate', (status) => {
        if (status.error) reject(new Error(status.error));
        else if (status.didJustFinish) resolve();
      });
      void signal.stopped.then(resolve); // Stop pressed: end this sound now
      try {
        sound.play();
      } catch (err) {
        reject(err);
      }
    });
  } finally {
    (subscription as { remove: () => void } | null)?.remove();
    if (currentSound === sound) {
      currentSound = null;
      releaseSound(sound);
    }
  }
}

interface SpeechState {
  messageId: number | null;
  loading: boolean;
  error: string | null;
  /** Speak a finished message (the Speak button). */
  speak: (message: Message) => Promise<void>;
  /** Voice conversation: start speaking a reply that is still being written. */
  liveStart: (message: Message) => Promise<void>;
  /** The reply grew: speak any sentences that just became complete. `text` is the whole reply so far. */
  liveFeed: (text: string) => void;
  /** The reply is finished: speak the rest. */
  liveEnd: (text: string) => void;
  stop: () => Promise<void>;
  clearError: () => void;
}

export const useSpeech = create<SpeechState>()((set, get) => {
  /** Builds a run (a pipeline wired to the phone's player and the PC's speech route), or null when this phone is not paired. */
  async function begin(message: Message, live: boolean): Promise<Run | null> {
    const { credentials, accessToken } = useAuth.getState();
    if (!credentials) {
      set({ error: 'This phone is not paired with a desktop.' });
      return null;
    }
    stopCurrent();
    const token = ++runCounter;
    const extraHeaders: Record<string, string> = {};
    if (credentials.cfAccessClientId) extraHeaders['CF-Access-Client-Id'] = credentials.cfAccessClientId;
    if (credentials.cfAccessClientSecret) extraHeaders['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
    const client = new JasperClient(credentials.baseUrl, accessToken ?? undefined, extraHeaders);
    const creds = { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret };
    const slug = message.from_slug || message.bot_slug;

    const run: Run = {
      token,
      slug,
      voice: '',
      splitter: live ? new LiveSplitter() : null,
      pipeline: new SpeechPipeline<File>({
        fetch: (text) => fetchChunkFile(client, text, run.voice, creds),
        play: playFile,
        discard: deleteFile,
        onFirstSound: () => {
          if (current?.token === token && get().loading) set({ loading: false });
        },
      }),
    };
    current = run;
    set({ messageId: message.id, loading: true, error: null });
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      // Playback may still work with the default audio mode.
    }

    run.pipeline.done
      .then(() => {
        if (current?.token === token) {
          current = null;
          set({ messageId: null, loading: false });
        }
      })
      .catch((err) => {
        if (current?.token === token) {
          stopCurrent();
          set({ messageId: null, loading: false, error: err instanceof Error ? err.message : 'Could not read the message aloud' });
        }
      });
    return run;
  }

  function pushChunk(run: Run, chunk: string): void {
    if (!run.voice) run.voice = voiceForText(run.slug, chunk); // Hindi / Hinglish / English voice from the first sentence
    for (const part of splitForSpeech(chunk, MAX_CHUNK)) run.pipeline.push(part);
  }

  return {
    messageId: null,
    loading: false,
    error: null,

    speak: async (message: Message) => {
      const text = cleanForSpeech(message.text);
      const chunks = splitForSpeechPipelined(text);
      if (chunks.length === 0) return;
      const run = await begin(message, false);
      if (!run) return;
      run.voice = voiceForText(run.slug, text);
      for (const chunk of chunks) pushChunk(run, chunk);
      run.pipeline.close();
    },

    liveStart: async (message: Message) => {
      await begin(message, true);
    },

    liveFeed: (text: string) => {
      const run = current;
      if (!run || !run.splitter || run.pipeline.isStopped) return;
      for (const chunk of run.splitter.push(text)) pushChunk(run, chunk);
    },

    liveEnd: (text: string) => {
      const run = current;
      if (!run || !run.splitter) return;
      if (!run.pipeline.isStopped) for (const chunk of run.splitter.flush(text)) pushChunk(run, chunk);
      run.pipeline.close();
    },

    stop: async () => {
      stopCurrent();
      set({ messageId: null, loading: false });
    },

    clearError: () => set({ error: null }),
  };
});
