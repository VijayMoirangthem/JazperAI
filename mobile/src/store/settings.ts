import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

interface SettingsState {
  appLock: boolean;
  notificationToggles: {
    approvals: boolean;
    mail: boolean;
    feature: boolean;
    alert: boolean;
  };
  setAppLock: (enabled: boolean) => void;
  setNotificationToggle: (type: keyof SettingsState['notificationToggles'], enabled: boolean) => void;
}

const storage: StateStorage = {
  getItem: (name: string) => {
    const value = localStorage.getItem(name);
    return value ? JSON.parse(value) : null;
  },
  setItem: (name: string, value: string) => localStorage.setItem(name, value),
  removeItem: (name: string) => localStorage.removeItem(name),
};

const createSettingsState = (set: (partial: SettingsState | Partial<SettingsState> | ((state: SettingsState) => SettingsState | Partial<SettingsState>)) => void) => ({
  appLock: false,
  notificationToggles: {
    approvals: true,
    mail: true,
    feature: true,
    alert: true,
  },
  setAppLock: (enabled: boolean) => set({ appLock: enabled }),
  setNotificationToggle: (type: keyof SettingsState['notificationToggles'], enabled: boolean) =>
    set((state: SettingsState) => ({
      notificationToggles: { ...state.notificationToggles, [type]: enabled },
    })),
});

export const useSettings = create<SettingsState>()(
  persist(
    createSettingsState,
    {
      name: 'jasper-settings',
      storage: createJSONStorage(() => storage),
    }
  )
);