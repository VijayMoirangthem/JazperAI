import { create } from "zustand";

export interface ViewerFile { src: string; id: string; name: string; mime: string; size?: number; modified?: string; modifiedTime?: string; webUrl?: string }

interface ViewerState {
  tabs: ViewerFile[];
  active: string | null;
  starred: string[];
  recent: string[];
  records: Record<string, ViewerFile>;
  dirty: string[];
  open: (f: ViewerFile) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  toggleStar: (id: string, file?: ViewerFile) => void;
  setDirty: (id: string, dirty: boolean) => void;
}

const KEY = "jasper.viewer.tabs.v1";
const load = (): Pick<ViewerState, "tabs" | "active" | "starred" | "recent" | "records" | "dirty"> => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v?.tabs) { const tabs = v.tabs.map((t: ViewerFile) => ({ ...t, src: t.src ?? "drive" })); return { tabs, active: v.active?.includes(":") ? v.active : (v.active ? `drive:${v.active}` : null), starred: v.starred ?? [], recent: v.recent ?? [], records: { ...Object.fromEntries(tabs.map((t: ViewerFile) => [`${t.src}:${t.id}`, t])), ...(v.records ?? {}) }, dirty: v.dirty ?? [] }; } } catch { /* ignore */ }
  return { tabs: [], active: null, starred: [], recent: [], records: {}, dirty: [] };
};
const save = (s: Pick<ViewerState, "tabs" | "active" | "starred" | "recent" | "records" | "dirty">) => { try { localStorage.setItem(KEY, JSON.stringify({ tabs: s.tabs, active: s.active, starred: s.starred, recent: s.recent, records: s.records, dirty: s.dirty })); } catch { /* ignore */ } };

/** Open files of the in-app viewer ("Files" panel): tabs survive switching panels and restarts. */
export const useFileViewer = create<ViewerState>((set) => ({
  ...load(),
  open: (f) => set((s) => { const key = `${f.src}:${f.id}`; const next = { tabs: s.tabs.some((t) => `${t.src}:${t.id}` === key) ? s.tabs : [...s.tabs, f], active: key, starred: s.starred, recent: [key, ...s.recent.filter(x => x !== key)].slice(0, 40), records: { ...s.records, [key]: f }, dirty: s.dirty }; save(next); return next; }),
  close: (id) => set((s) => { const tabs = s.tabs.filter((t) => `${t.src}:${t.id}` !== id); const next = { tabs, active: s.active === id ? (tabs.length ? `${tabs.at(-1)!.src}:${tabs.at(-1)!.id}` : null) : s.active, starred: s.starred, recent: s.recent, records: s.records, dirty: s.dirty.filter(x => x !== id) }; save(next); return next; }),
  activate: (id) => set((s) => { const next = { tabs: s.tabs, active: id, starred: s.starred, recent: s.recent, records: s.records, dirty: s.dirty }; save(next); return next; }),
  toggleStar: (id, file) => set((s) => { const known = file ?? s.records[id] ?? s.tabs.find((tab) => `${tab.src}:${tab.id}` === id); const next = { tabs: s.tabs, active: s.active, starred: s.starred.includes(id) ? s.starred.filter(x => x !== id) : [...s.starred, id], recent: s.recent, records: known ? { ...s.records, [id]: known } : s.records, dirty: s.dirty }; save(next); return next; }),
  setDirty: (id, dirty) => set((s) => { const next = { tabs: s.tabs, active: s.active, starred: s.starred, recent: s.recent, records: s.records, dirty: dirty ? (s.dirty.includes(id) ? s.dirty : [...s.dirty, id]) : s.dirty.filter(x => x !== id) }; save(next); return next; }),
}));
