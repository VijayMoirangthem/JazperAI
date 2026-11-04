import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NotificationToggles } from '@/notifications/routing';
import { ThemeMode, THEME_MODE, writeThemeMode } from '@/theme/tokens';
import { secureStateStorage } from './storage';

interface SettingsState {
  appLock: boolean;
  notificationToggles: NotificationToggles;
  themeMode: ThemeMode;
  readAloud: boolean;
  voiceAutoSend: boolean;
  showToolDetails: boolean;
  profileName: string;
  setProfileName: (name: string) => void;
  setAppLock: (enabled: boolean) => void;
  setNotificationToggle: (type: keyof NotificationToggles, enabled: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setReadAloud: (enabled: boolean) => void;
  setVoiceAutoSend: (enabled: boolean) => void;
  setShowToolDetails: (enabled: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appLock: false,
      notificationToggles: { approvals: true, mail: true, feature: true, alert: true },
      themeMode: THEME_MODE,
      readAloud: false,
      voiceAutoSend: false,
      showToolDetails: false,
      profileName: '',
      setProfileName: (name: string) => set({ profileName: name.slice(0, 40) }),
      setAppLock: (enabled: boolean) => set({ appLock: enabled }),
      setNotificationToggle: (type: keyof NotificationToggles, enabled: boolean) =>
        set((state: SettingsState) => ({
          notificationToggles: { ...state.notificationToggles, [type]: enabled },
        })),
      setThemeMode: (mode: ThemeMode) => {
        writeThemeMode(mode);
        set({ themeMode: mode });
      },
      setReadAloud: (enabled: boolean) => set({ readAloud: enabled }),
      setVoiceAutoSend: (enabled: boolean) => set({ voiceAutoSend: enabled }),
      setShowToolDetails: (enabled: boolean) => set({ showToolDetails: enabled }),
    }),
    {
      name: 'jasper-settings',
      storage: createJSONStorage(() => secureStateStorage),
    }
  )
);
