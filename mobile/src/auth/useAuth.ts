import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { StoredCredentials } from '@/api/types';

interface AuthState {
  accessToken: string | null;
  deviceId: string | null;
  deviceName: string | null;
  credentials: StoredCredentials | null;
  hydrated: boolean;
  setTokens: (accessToken: string, deviceId: string, deviceName: string) => void;
  setCredentials: (credentials: StoredCredentials) => void;
  clear: () => void;
  setHydrated: (hydrated: boolean) => void;
}

const storage: StateStorage = {
  getItem: (name: string) => {
    const value = localStorage.getItem(name);
    return value ? JSON.parse(value) : null;
  },
  setItem: (name: string, value: string) => localStorage.setItem(name, value),
  removeItem: (name: string) => localStorage.removeItem(name),
};

const createAuthState = (set: (partial: AuthState | Partial<AuthState> | ((state: AuthState) => AuthState | Partial<AuthState>)) => void) => ({
  accessToken: null,
  deviceId: null,
  deviceName: null,
  credentials: null,
  hydrated: false,
  setTokens: (accessToken: string, deviceId: string, deviceName: string) => set({ accessToken, deviceId, deviceName }),
  setCredentials: (credentials: StoredCredentials) => set({ credentials }),
  clear: () => set({ accessToken: null, deviceId: null, deviceName: null, credentials: null }),
  setHydrated: (hydrated: boolean) => set({ hydrated }),
});

const useAuthBase = create<AuthState>()(
  persist(
    createAuthState,
    {
      name: 'jasper-auth',
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        credentials: state.credentials,
      }),
      onRehydrateStorage: () => (state: AuthState | undefined) => {
        if (state) {
          state.setHydrated(true);
        }
      },
    }
  )
);

export const useAuth = useAuthBase;