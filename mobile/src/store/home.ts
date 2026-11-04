import { create } from 'zustand';
import * as Notifications from 'expo-notifications';
import {
  BotMeta,
  listBotMeta,
  markRead as dbMarkRead,
  markUnread as dbMarkUnread,
  setMuted as dbSetMuted,
  setPinned as dbSetPinned,
} from '@/db/meta';

interface HomeState {
  meta: Record<string, BotMeta>;
  refresh: () => void;
  togglePin: (slug: string) => void;
  toggleMute: (slug: string) => void;
  markRead: (slug: string) => void;
  markUnread: (slug: string) => void;
}

function toMap(rows: BotMeta[]): Record<string, BotMeta> {
  const out: Record<string, BotMeta> = {};
  for (const row of rows) out[row.slug] = row;
  return out;
}

export const useHome = create<HomeState>()((set, get) => ({
  meta: {},
  refresh: () => {
    try {
      const rows = listBotMeta();
      set({ meta: toMap(rows) });
      // The app icon badge counts chats with something new (muted ones stay quiet).
      void Notifications.setBadgeCountAsync(rows.filter((r) => r.unread && !r.muted).length).catch(() => undefined);
    } catch {
      // The local database may not be ready on the very first frame.
    }
  },
  togglePin: (slug) => {
    dbSetPinned(slug, !get().meta[slug]?.pinned);
    get().refresh();
  },
  toggleMute: (slug) => {
    dbSetMuted(slug, !get().meta[slug]?.muted);
    get().refresh();
  },
  markRead: (slug) => {
    dbMarkRead(slug);
    get().refresh();
  },
  markUnread: (slug) => {
    dbMarkUnread(slug);
    get().refresh();
  },
}));
