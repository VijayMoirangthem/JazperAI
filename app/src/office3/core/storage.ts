const warn = (key: string) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("office3:storage-warning", { detail: key })); };

/** Local-only Office data must never make a scene action throw when storage is full or unavailable. */
export const safeStorage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): boolean { try { localStorage.setItem(key, value); return true; } catch { warn(key); return false; } },
  remove(key: string): boolean { try { localStorage.removeItem(key); return true; } catch { warn(key); return false; } },
};
