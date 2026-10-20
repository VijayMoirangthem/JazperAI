"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useViewActive } from "./viewActive";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  promise?: Promise<T>;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readFromSessionStorage<T>(key: string): CacheEntry<T> | null {
  const ss = getSessionStorage();
  if (!ss) return null;
  try {
    const raw = ss.getItem(key);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    return { data, timestamp } as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeToSessionStorage(key: string, data: unknown, timestamp: number) {
  const ss = getSessionStorage();
  if (!ss) return;
  try {
    ss.setItem(key, JSON.stringify({ data, timestamp }));
  } catch {
    // ignore quota errors
  }
}

// per-URL subscribers: every write to the cache notifies the components showing that URL, so background refreshes and polls actually render
const listeners = new Map<string, Set<() => void>>();
function subscribeTo(key: string) {
  return (callback: () => void) => {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(callback);
    return () => { set!.delete(callback); };
  };
}
function notify(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

function getSnapshot<T>(key: string): T | undefined {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  return entry?.data;
}

export interface UseApiOptions<T> {
  ttl?: number;
  poll?: number | false;
  revalidateOnFocus?: boolean;
  onError?: (error: Error) => void;
  initialData?: T;
}

export interface UseApiResult<T> {
  data: T | undefined;
  loading: boolean;
  stale: boolean;
  error: Error | null;
  refresh: () => Promise<T | undefined>;
  mutate: (data: T | ((prev: T | undefined) => T), options?: { revalidate?: boolean }) => Promise<T | undefined>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      // ignore
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json();
}

export function useApi<T = unknown>(url: string, options: UseApiOptions<T> = {}): UseApiResult<T> {
  const {
    ttl = 5000,
    poll = 5000,
    revalidateOnFocus = true,
    onError,
    initialData,
  } = options;

  const cacheKey = url;
  const active = useViewActive();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const inflightRef = useRef<Promise<T> | null>(null);

  const getCached = useCallback((): CacheEntry<T> | undefined => {
    let entry = memoryCache.get(cacheKey) as CacheEntry<T> | undefined;
    if (entry) return entry;

    const stored = readFromSessionStorage<T>(cacheKey);
    if (stored && Date.now() - stored.timestamp < ttl) {
      memoryCache.set(cacheKey, stored);
      return stored;
    }
    return undefined;
  }, [cacheKey, ttl]);

  const subscribe = useMemo(() => subscribeTo(cacheKey), [cacheKey]);
  const cachedData = useSyncExternalStore(
    subscribe,
    () => getCached()?.data,
    () => initialData
  );

  const cacheEntry = getCached();
  const data = cachedData ?? initialData;
  const stale = cacheEntry ? Date.now() - cacheEntry.timestamp > ttl : !cacheEntry;

  const fetchData = useCallback(async (isBackground = false): Promise<T | undefined> => {
    if (!mounted.current) return undefined;

    if (!isBackground) setLoading(true);
    setError(null);

    const existingPromise = inflight.get(cacheKey) as Promise<T> | undefined;
    if (existingPromise) {
      try {
        const result = await existingPromise;
        if (!isBackground) setLoading(false);
        return result;
      } catch (e) {
        // fall through to refetch
      }
    }

    const promise = (async () => {
      const result = await fetchJson<T>(url);
      const entry: CacheEntry<T> = { data: result, timestamp: Date.now() };
      memoryCache.set(cacheKey, entry);
      writeToSessionStorage(cacheKey, result, entry.timestamp);
      notify(cacheKey);
      return result;
    })();

    inflight.set(cacheKey, promise);
    inflightRef.current = promise;

    try {
      const result = await promise;
      if (!mounted.current) return undefined;
      if (!isBackground) setLoading(false);
      return result;
    } catch (e) {
      if (!mounted.current) return undefined;
      const err = e as Error;
      if (!isBackground) {
        setLoading(false);
        setError(err);
        onError?.(err);
      }
      return undefined;
    } finally {
      inflight.delete(cacheKey);
    }
  }, [cacheKey, url, onError]);

  const refresh = useCallback(async () => {
    const result = await fetchData(false);
    return result;
  }, [fetchData]);

  const mutate = useCallback(
    async (updater: T | ((prev: T | undefined) => T), opts?: { revalidate?: boolean }) => {
      const newData = typeof updater === "function" ? (updater as (prev: T | undefined) => T)(data) : updater;
      const entry: CacheEntry<T> = { data: newData, timestamp: Date.now() };
      memoryCache.set(cacheKey, entry);
      writeToSessionStorage(cacheKey, newData, entry.timestamp);
      notify(cacheKey);

      if (opts?.revalidate !== false) {
        return fetchData(false);
      }
      return newData;
    },
    [cacheKey, data, fetchData]
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const cached = getCached();
    if (cached && !stale) return;

    if (!inflight.has(cacheKey)) {
      void fetchData(false);
    }
  }, [url, cacheKey, fetchData, getCached, stale]);

  useEffect(() => {
    if (!active) {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
      return;
    }

    if (poll && poll > 0) {
      pollInterval.current = setInterval(() => {
        if (active && mounted.current) {
          fetchData(true);
        }
      }, poll);
    }

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
    };
  }, [active, poll, fetchData]);

  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      if (active && mounted.current) {
        const cached = getCached();
        if (cached && Date.now() - cached.timestamp > ttl) {
          fetchData(true);
        }
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [active, revalidateOnFocus, ttl, fetchData, getCached]);

  return {
    data,
    loading: loading && !data,
    stale,
    error,
    refresh,
    mutate,
  };
}

export function preload<T>(url: string): Promise<T | undefined> {
  const cacheKey = url;
  if (memoryCache.has(cacheKey)) return Promise.resolve(undefined);
  if (inflight.has(cacheKey)) return inflight.get(cacheKey) as Promise<T>;

  const promise = fetchJson<T>(url).then((data) => {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    memoryCache.set(cacheKey, entry);
    writeToSessionStorage(cacheKey, data, entry.timestamp);
    notify(cacheKey);
    return data;
  });
  inflight.set(cacheKey, promise);
  return promise.finally(() => inflight.delete(cacheKey));
}

export function clearCache(url?: string) {
  if (url) {
    memoryCache.delete(url);
    const ss = getSessionStorage();
    if (ss) ss.removeItem(url);
    notify(url);
  } else {
    const keys0 = [...memoryCache.keys()];
    memoryCache.clear();
    keys0.forEach(notify);
    const ss = getSessionStorage();
    if (ss) {
      const keys: string[] = [];
      for (let i = 0; i < ss.length; i++) {
        const key = ss.key(i);
        if (key) keys.push(key);
      }
      keys.forEach((k) => ss.removeItem(k));
    }
  }
}