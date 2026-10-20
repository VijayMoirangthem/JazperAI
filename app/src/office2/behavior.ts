import { hash } from "./hash.ts";
import type { Place } from "./types.ts";

/** Which place an agent goes to for a given agent state and local hour (0-23). */
export function placeFor(state: string, hour: number): Place {
  switch (state) {
    case "planning": return "meeting";
    case "waiting_tool":
    case "testing":
    case "repairing": return "tools";
    case "waiting_human":
    case "escalated": return "founder";
    case "working":
    case "error":
    case "rolled_back":
    case "deprecated": return "desk";
    default: return hour >= 12 && hour < 13 ? "lounge" : "desk"; // idle: lunch hour in the lounge
  }
}

export interface WalkQueue {
  request(id: string): boolean; // true = start walking now, false = queued
  finish(id: string): string | null; // call when id stopped walking (or was removed); returns the id that may start now
  active(): string[];
  waiting(): string[];
}

/** At most `max` agents walk at once; the rest wait in FIFO order. */
export function createWalkQueue(max = 4): WalkQueue {
  const active = new Set<string>();
  const waiting: string[] = [];
  return {
    request(id) {
      if (active.has(id)) return true;
      if (waiting.includes(id)) return false;
      if (active.size < max) { active.add(id); return true; }
      waiting.push(id);
      return false;
    },
    finish(id) {
      active.delete(id);
      const w = waiting.indexOf(id);
      if (w >= 0) waiting.splice(w, 1);
      if (active.size < max && waiting.length) { const next = waiting.shift()!; active.add(next); return next; }
      return null;
    },
    active: () => [...active],
    waiting: () => [...waiting],
  };
}

/** Stable spot for a slug: start at hash(slug) % n and probe forward to the first free spot; null when every spot is taken. */
export function assignSpot<T extends { x: number; y: number }>(spots: readonly T[], taken: ReadonlySet<string>, slug: string): T | null {
  if (!spots.length) return null;
  const start = hash(slug) % spots.length;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[(start + i) % spots.length];
    if (!taken.has(`${s.x},${s.y}`)) return s;
  }
  return null;
}

/** Ring colour under an avatar per agent state (0xRRGGBB). Unknown states use the idle colour. */
export const STATE_RING: Readonly<Record<string, number>> = {
  idle: 0x64748b, working: 0x22c55e, planning: 0x38bdf8, waiting_human: 0xf59e0b, error: 0xef4444, testing: 0xa855f7,
  waiting_tool: 0x14b8a6, repairing: 0xf97316, rolled_back: 0xdc2626, escalated: 0xfbbf24, deprecated: 0x475569,
};
export const ringColor = (state: string): number => STATE_RING[state] ?? STATE_RING.idle;
/** States that need a human: their name tag and bubble stay visible. */
export const isAttention = (state: string): boolean => state === "error" || state === "waiting_human" || state === "escalated";
