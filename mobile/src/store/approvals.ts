import { create } from 'zustand';
import { ApprovalRequest, RespondRequest } from '@/api/types';
import { HttpError, JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { loadCredentials } from '@/auth/secureStore';
import * as LocalAuthentication from 'expo-local-authentication';
import { respondToApproval } from '@/approvals/respond';

export const BIOMETRIC_SETUP_MESSAGE =
  'Set up a fingerprint or face unlock to approve this on the phone';

interface ApprovalsState {
  requests: ApprovalRequest[];
  loading: boolean;
  error: string | null;
  responding: Record<string, boolean>;
  load: () => Promise<void>;
  respond: (request: ApprovalRequest, approve: boolean) => Promise<void>;
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

async function hasBiometrics(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

async function authenticate(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirm this approval',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}

async function readDeviceSecret(): Promise<string | null> {
  const credentials = await loadCredentials();
  if (credentials?.deviceSecret) return credentials.deviceSecret;
  return useAuth.getState().deviceSecret;
}

export const useApprovals = create<ApprovalsState>()((set, get) => ({
  requests: [],
  loading: false,
  error: null,
  responding: {},

  load: async () => {
    const client = createClient();
    const { credentials } = useAuth.getState();
    if (!client || !credentials) return;

    set({ loading: true });
    try {
      const response = await client.getApprovals({
        deviceId: credentials.deviceId,
        deviceSecret: credentials.deviceSecret,
      });
      set({ requests: response.requests, error: null, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not load approvals', loading: false });
    }
  },

  respond: async (request: ApprovalRequest, approve: boolean) => {
    const client = createClient();
    const { credentials } = useAuth.getState();
    if (!client || !credentials) return;

    set({ responding: { ...get().responding, [request.request_id]: true }, error: null });
    try {
      const outcome = await respondToApproval(request, approve, {
        hasBiometrics,
        authenticate,
        getDeviceSecret: readDeviceSecret,
        send: (body: RespondRequest) =>
          client.respondApproval(request.request_id, body, {
            deviceId: credentials.deviceId,
            deviceSecret: credentials.deviceSecret,
          }),
      });

      if (outcome === 'no-biometrics') {
        set({ error: BIOMETRIC_SETUP_MESSAGE });
      } else if (outcome !== 'cancelled') {
        set({ requests: get().requests.filter((item) => item.request_id !== request.request_id) });
      }
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        set({ error: BIOMETRIC_SETUP_MESSAGE });
      } else {
        set({ error: err instanceof Error ? err.message : 'Could not respond to the approval' });
      }
    } finally {
      const next = { ...get().responding };
      delete next[request.request_id];
      set({ responding: next });
    }
  },

  clearError: () => set({ error: null }),
}));
