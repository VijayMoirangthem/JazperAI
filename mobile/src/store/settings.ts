import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { NotificationToggles } from '@/notifications/routing';

interface SettingsState {
  appLock: boolean;
  notificationToggles: NotificationToggles;
  setAppLock: (enabled: boolean) => void;
  setNotificationToggle: (type: keyof NotificationToggles, enabled: boolean) => void;
}

const storage: StateStorage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

const createSettingsState = (
  set: (
    partial: SettingsState | Partial<SettingsState> | ((state: SettingsState) => SettingsState | Partial<SettingsState>)
  ) => void
) => ({
  appLock: false,
  notificationToggles: {
    approvals: true,
    mail: true,
    feature: true,
    alert: true,
  },
  setAppLock: (enabled: boolean) => set({ appLock: enabled }),
  setNotificationToggle: (type: keyof NotificationToggles, enabled: boolean) =>
    set((state: SettingsState) => ({
      notificationToggles: { ...state.notificationToggles, [type]: enabled },
    })),
});

export const useSettings = create<SettingsState>()(
  persist(createSettingsState, {
    name: 'jasper-settings',
    storage: createJSONStorage(() => storage),
  })
);
