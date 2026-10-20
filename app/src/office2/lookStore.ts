import type { Look } from "./types.ts";

const KEY = "office2.looks";

/** Appearance overrides per slug, kept in localStorage (single user, single machine). Never throws. */
export function readLooks(): Record<string, Partial<Look>> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<Look>>; } catch { return {}; }
}
export function writeLook(slug: string, partial: Partial<Look>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readLooks(), [slug]: { ...readLooks()[slug], ...partial } })); } catch { /* storage unavailable */ }
}
