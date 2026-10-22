import { create } from "zustand";

export interface ViewerFile { id: string; name: string; mime: string }

interface ViewerState {
  tabs: ViewerFile[];
  active: string | null;
  open: (f: ViewerFile) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
}

const KEY = "jasper.viewer.tabs.v1";
const load = (): Pick<ViewerState, "tabs" | "active"> => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v?.tabs) return v; } catch { /* ignore */ }
  return { tabs: [], active: null };
};
const save = (s: Pick<ViewerState, "tabs" | "active">) => { try { localStorage.setItem(KEY, JSON.stringify({ tabs: s.tabs, active: s.active })); } catch { /* ignore */ } };

/** Open files of the in-app viewer ("Files" panel): tabs survive switching panels and restarts. */
export const useFileViewer = create<ViewerState>((set) => ({
  ...load(),
  open: (f) => set((s) => { const next = { tabs: s.tabs.some((t) => t.id === f.id) ? s.tabs : [...s.tabs, f], active: f.id }; save(next); return next; }),
  close: (id) => set((s) => { const tabs = s.tabs.filter((t) => t.id !== id); const next = { tabs, active: s.active === id ? (tabs.at(-1)?.id ?? null) : s.active }; save(next); return next; }),
  activate: (id) => set((s) => { const next = { tabs: s.tabs, active: id }; save(next); return next; }),
}));
