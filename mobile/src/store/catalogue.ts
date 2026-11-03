import { create } from 'zustand';
import { ConnectorsResponse } from '@/api/types';

interface CatalogueState {
  data: ConnectorsResponse | null;
  requested: Record<string, boolean>;
  setData: (data: ConnectorsResponse) => void;
  markRequested: (id: string) => void;
}

// Kept in memory so the Plugins sheet opens instantly and search can list plugins.
export const useCatalogue = create<CatalogueState>()((set) => ({
  data: null,
  requested: {},
  setData: (data) => set({ data }),
  markRequested: (id) => set((s) => ({ requested: { ...s.requested, [id]: true } })),
}));
