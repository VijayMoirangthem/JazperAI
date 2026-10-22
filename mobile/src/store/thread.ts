import { create } from 'zustand';
import { CommsMessage } from '@/api/types';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';

interface ThreadState {
  threadId: string | null;
  messages: CommsMessage[];
  sinceId: number;
  loading: boolean;
  error: string | null;
  open: (threadId: string) => void;
  load: (threadId: string) => Promise<void>;
  close: () => void;
  clearError: () => void;
}

function createClient(): JasperClient | null {
  const { credentials, accessToken } = useAuth.getState();
  if (!credentials) return null;
  const extraHeaders: Record<string, string> = {};
  if (credentials.cfAccessClientId) extraHeaders['CF-Access-Client-Id'] = credentials.cfAccessClientId;
  if (credentials.cfAccessClientSecret) {
    extraHeaders['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
  }
  return new JasperClient(credentials.baseUrl, accessToken ?? undefined, extraHeaders);
}

export function mergeMessages(
  existing: CommsMessage[],
  incoming: CommsMessage[]
): CommsMessage[] {
  const byId = new Map<number, CommsMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

export const useThread = create<ThreadState>()((set, get) => ({
  threadId: null,
  messages: [],
  sinceId: 0,
  loading: false,
  error: null,

  open: (threadId: string) => {
    if (get().threadId === threadId) return;
    set({ threadId, messages: [], sinceId: 0, error: null, loading: false });
  },

  close: () => set({ threadId: null, messages: [], sinceId: 0, error: null, loading: false }),

  load: async (threadId: string) => {
    const client = createClient();
    const { credentials } = useAuth.getState();
    if (!client || !credentials) return;

    const sinceId = get().threadId === threadId ? get().sinceId : 0;
    set({ loading: true });
    try {
      const response = await client.getCommsThread(threadId, sinceId, {
        deviceId: credentials.deviceId,
        deviceSecret: credentials.deviceSecret,
      });
      if (get().threadId !== threadId) return;
      const messages = mergeMessages(get().messages, response.messages);
      const nextSince = messages.reduce((max, message) => Math.max(max, message.id), sinceId);
      set({ messages, sinceId: nextSince, error: null, loading: false });
    } catch (err) {
      if (get().threadId !== threadId) return;
      set({
        error: err instanceof Error ? err.message : 'Could not load this thread',
        loading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
