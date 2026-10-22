import { create } from 'zustand';
import { CommsThread, StatusResponse } from '@/api/types';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';

interface ActivityState {
  status: StatusResponse | null;
  threads: CommsThread[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
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

export const useActivity = create<ActivityState>()((set) => ({
  status: null,
  threads: [],
  loading: false,
  error: null,

  load: async () => {
    const client = createClient();
    const { credentials } = useAuth.getState();
    if (!client || !credentials) return;

    set({ loading: true });
    try {
      const [status, comms] = await Promise.all([
        client.getStatus({
          deviceId: credentials.deviceId,
          deviceSecret: credentials.deviceSecret,
        }),
        client.getCommsThreads({
          deviceId: credentials.deviceId,
          deviceSecret: credentials.deviceSecret,
        }),
      ]);
      set({ status, threads: comms.threads, error: null, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Could not load activity',
        loading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
