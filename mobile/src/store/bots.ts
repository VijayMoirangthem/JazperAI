import { create } from 'zustand';
import { BotGroup, Bot } from '@/api/types';
import { JasperClient } from '@/api/client';
import { loadBotGroups, saveBotGroups, clearBotCache, initBotsDb } from '@/db/bots';
import { useAuth } from '@/auth/useAuth';

interface BotsState {
  groups: BotGroup[];
  loading: boolean;
  error: string | null;
  search: string;
  loadBots: (client: JasperClient) => Promise<void>;
  setSearch: (search: string) => void;
  clearError: () => void;
  clearCache: () => void;
}

type SetState = (partial: BotsState | Partial<BotsState> | ((state: BotsState) => BotsState | Partial<BotsState>)) => void;
type GetState = () => BotsState;

export const useBots = create<BotsState>((set: SetState, get: () => BotsState) => ({
  groups: [],
  loading: false,
  error: null,
  search: '',

  loadBots: async (client: JasperClient) => {
    const { deviceId, deviceSecret } = useAuth.getState();
    if (!deviceId || !deviceSecret) return;

    // Load cached data first for instant display
    try {
      initBotsDb();
      const cached = loadBotGroups();
      if (cached.length > 0) {
        set({ groups: cached, error: null });
      }
    } catch {
      // Ignore cache errors
    }

    set({ loading: true, error: null });

    try {
      const response = await client.getBots({ deviceId, deviceSecret });
      saveBotGroups(response.groups);
      set({ groups: response.groups, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load bots';
      set({ error: message, loading: false });
    }
  },

  setSearch: (search: string) => set({ search }),

  clearError: () => set({ error: null }),

  clearCache: () => {
    clearBotCache();
    set({ groups: [] });
  },
}));

// Selectors for filtered bots
export function useFilteredBots() {
  const { groups, search } = useBots();
  const searchLower = search.toLowerCase();

  if (!search) return groups;

  return groups
    .map((group: BotGroup) => ({
      ...group,
      bots: group.bots.filter(
        (bot: Bot) =>
          bot.display_name.toLowerCase().includes(searchLower) ||
          bot.position.toLowerCase().includes(searchLower) ||
          bot.department.toLowerCase().includes(searchLower) ||
          bot.slug.toLowerCase().includes(searchLower)
      ),
    }))
    .filter((group: BotGroup) => group.bots.length > 0);
}