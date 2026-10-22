import { create } from 'zustand';
import { StoredCredentials } from '@/api/types';

interface AuthState {
  accessToken: string | null;
  deviceId: string | null;
  deviceSecret: string | null;
  deviceName: string | null;
  credentials: StoredCredentials | null;
  hydrated: boolean;
  setTokens: (accessToken: string, deviceId: string, deviceName: string) => void;
  setCredentials: (credentials: StoredCredentials) => void;
  clear: () => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuth = create<AuthState>()((set) => ({
  accessToken: null,
  deviceId: null,
  deviceSecret: null,
  deviceName: null,
  credentials: null,
  hydrated: true,
  setTokens: (accessToken: string, deviceId: string, deviceName: string) =>
    set({ accessToken, deviceId, deviceName }),
  setCredentials: (credentials: StoredCredentials) =>
    set({
      credentials,
      deviceId: credentials.deviceId,
      deviceSecret: credentials.deviceSecret,
    }),
  clear: () =>
    set({
      accessToken: null,
      deviceId: null,
      deviceSecret: null,
      deviceName: null,
      credentials: null,
    }),
  setHydrated: (hydrated: boolean) => set({ hydrated }),
}));
