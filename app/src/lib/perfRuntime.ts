// Client side of Performance Settings: a tiny framework-free store (readable from non-React code such as swr.ts, stores and
// render loops), poll scaling, and update coalescing. Settings are owned by the backend (/api/performance/settings) and cached
// in localStorage so the first paint after a restart already uses the last known values.

export type Animations = "off" | "reduced" | "full";

export interface PerfSettings {
  preset: string;
  max_active_agents: number;
  max_concurrent_tasks: number;
  max_background_jobs: number;
  background_jobs_enabled: boolean;
  poll_scale: number;
  ui_update_ms: number;
  animations: Animations;
  max_fps: number;
  show_inactive_agents: boolean;
  log_level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  log_retention_entries: number;
  mcp_autoconnect: boolean;
  file_watcher: boolean;
  auto_repair_loop: boolean;
  pii_engine: "presidio" | "regex";
  memory_budget_mb: number;
}

/** Today's behaviour (no throttling) until the backend answers. */
export const DEFAULTS: PerfSettings = {
  preset: "default", max_active_agents: 0, max_concurrent_tasks: 6, max_background_jobs: 4, background_jobs_enabled: true,
  poll_scale: 1, ui_update_ms: 100, animations: "full", max_fps: 60, show_inactive_agents: false, log_level: "INFO",
  log_retention_entries: 2000, mcp_autoconnect: true, file_watcher: true, auto_repair_loop: true, pii_engine: "presidio",
  memory_budget_mb: 2048,
};

const CACHE_KEY = "jazper.perf.settings.v1";

function readCache(): PerfSettings | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CACHE_KEY) : null;
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

let current: PerfSettings = readCache() ?? DEFAULTS;
const subscribers = new Set<() => void>();

export const getPerf = (): PerfSettings => current;
export const getPollScale = (): number => current.poll_scale;
export const getMaxFps = (): number => current.max_fps;
export const subscribePerf = (cb: () => void): (() => void) => {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
};

function applyToDocument(s: PerfSettings): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.animations = s.animations;               // CSS in index.css switches animations/transitions off or shortens them
  el.style.setProperty("--perf-max-fps", String(s.max_fps));
}

/** Replace the settings (normally with the backend's answer), persist them for the next start and notify subscribers. */
export function setPerf(next: Partial<PerfSettings>): PerfSettings {
  current = { ...current, ...next };
  try { if (typeof localStorage !== "undefined") localStorage.setItem(CACHE_KEY, JSON.stringify(current)); } catch { /* private mode */ }
  applyToDocument(current);
  subscribers.forEach((f) => f());
  return current;
}

export async function loadPerf(apiBase: string): Promise<PerfSettings> {
  try {
    const r = await fetch(`${apiBase}/api/performance/settings`);
    if (r.ok) setPerf((await r.json()).settings);
  } catch { /* backend not up yet: keep cached/default values */ }
  return current;
}

/** Stretch a polling interval by the poll scale. `false`/0/undefined (no polling) pass through untouched. */
export function scalePoll<T extends number | false | undefined>(ms: T, scale: number = current.poll_scale): T {
  if (typeof ms !== "number" || ms <= 0) return ms;
  return Math.round(ms * Math.max(1, scale)) as T;
}

/** Drop-in for setInterval: scaled by the poll scale and silent while the window is hidden. Works with clearInterval. */
export function setScaledInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fn();
  }, scalePoll(ms));
}

/** Batch bursts of updates: everything pushed within one window runs together (one React render) after `getMs()` ms. */
export function createCoalescer(getMs: () => number = () => current.ui_update_ms) {
  let queue: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const batch = queue;
    queue = [];
    for (const f of batch) f();
  };
  return {
    push(f: () => void) {
      queue.push(f);
      if (timer === null) timer = setTimeout(flush, Math.max(0, getMs()));
    },
    flush() { if (timer !== null) clearTimeout(timer); flush(); },
    pending: () => queue.length,
  };
}

/** True when a frame should be skipped to stay under the FPS cap (used by render loops). */
export function shouldSkipFrame(now: number, last: number, maxFps: number = current.max_fps): boolean {
  return maxFps > 0 && now - last < 1000 / maxFps - 1;
}
