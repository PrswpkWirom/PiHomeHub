import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";

import { api, StaleRequestError } from "../api/client";

const DEFAULT_STALE_TIME_MS = 30_000;

type CacheEntry<T = unknown> = {
  data: T | null;
  hasData: boolean;
  error: string | null;
  updatedAt: number | null;
  promise: Promise<T> | null;
  requestVersion: number;
  subscribers: Set<() => void>;
};

type FetchOptions = {
  staleTimeMs?: number;
  refetchIntervalMs?: number;
  enabled?: boolean;
};

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  updatedAt: number | null;
};

const cache = new Map<string, CacheEntry>();

function getEntry<T>(path: string) {
  let entry = cache.get(path) as CacheEntry<T> | undefined;
  if (!entry) {
    entry = {
      data: null,
      hasData: false,
      error: null,
      updatedAt: null,
      promise: null,
      requestVersion: 0,
      subscribers: new Set()
    };
    cache.set(path, entry as CacheEntry);
  }
  return entry;
}

function notify(entry: CacheEntry) {
  entry.subscribers.forEach((subscriber) => subscriber());
}

function readState<T>(path: string): FetchState<T> {
  const entry = getEntry<T>(path);
  const refreshing = entry.promise !== null;
  return {
    data: entry.hasData ? entry.data : null,
    loading: refreshing && !entry.hasData,
    error: entry.error,
    refreshing,
    updatedAt: entry.updatedAt
  };
}

function isStale(entry: CacheEntry, staleTimeMs: number) {
  if (!entry.hasData || entry.updatedAt === null) {
    return true;
  }
  return Date.now() - entry.updatedAt >= staleTimeMs;
}

function load<T>(path: string, force = false) {
  const entry = getEntry<T>(path);
  if (entry.promise) {
    return entry.promise;
  }
  if (!force && !isStale(entry, DEFAULT_STALE_TIME_MS)) {
    return Promise.resolve(entry.data as T);
  }

  entry.error = null;
  const requestVersion = ++entry.requestVersion;
  entry.promise = api
    .get<T>(path)
    .then((result) => {
      if (entry.requestVersion !== requestVersion) return result;
      entry.data = result;
      entry.hasData = true;
      entry.updatedAt = Date.now();
      entry.error = null;
      notify(entry as CacheEntry);
      return result;
    })
    .catch((err: Error) => {
      if (err instanceof StaleRequestError || entry.requestVersion !== requestVersion) throw err;
      entry.error = err.message;
      notify(entry as CacheEntry);
      throw err;
    })
    .finally(() => {
      if (entry.requestVersion === requestVersion) {
        entry.promise = null;
        notify(entry as CacheEntry);
      }
    });

  notify(entry as CacheEntry);
  return entry.promise;
}

export function setCachedData<T>(path: string, value: SetStateAction<T | null>) {
  const entry = getEntry<T>(path);
  const current = entry.hasData ? entry.data : null;
  const nextData = typeof value === "function" ? (value as (previous: T | null) => T | null)(current) : value;
  entry.requestVersion += 1;
  entry.promise = null;
  entry.data = nextData;
  entry.hasData = true;
  entry.error = null;
  entry.updatedAt = Date.now();
  notify(entry as CacheEntry);
}

export function invalidateCache(path: string) {
  const entry = cache.get(path);
  if (!entry) {
    return;
  }
  invalidateEntry(entry);
}

export function invalidateCachePrefix(prefix: string) {
  cache.forEach((entry, path) => {
    if (path.startsWith(prefix)) invalidateEntry(entry);
  });
}

function invalidateEntry(entry: CacheEntry) {
  if (entry.promise) {
    entry.requestVersion += 1;
    entry.promise = null;
  }
  entry.updatedAt = 0;
  notify(entry);
}

export function clearApiCache() {
  cache.forEach((entry) => {
    entry.requestVersion += 1;
    entry.data = null;
    entry.hasData = false;
    entry.error = null;
    entry.updatedAt = null;
    entry.promise = null;
  });
  cache.clear();
}

export function useFetch<T>(path: string, options: FetchOptions = {}) {
  const { staleTimeMs = DEFAULT_STALE_TIME_MS, refetchIntervalMs, enabled = true } = options;
  const [state, setState] = useState<FetchState<T>>(() => readState<T>(path));

  useEffect(() => {
    const entry = getEntry<T>(path);
    const subscriber = () => setState(readState<T>(path));
    entry.subscribers.add(subscriber);
    subscriber();
    return () => {
      entry.subscribers.delete(subscriber);
    };
  }, [path]);

  useEffect(() => {
    const entry = getEntry<T>(path);
    if (enabled && isStale(entry, staleTimeMs)) {
      void load<T>(path, true).catch(() => undefined);
    }
  }, [enabled, path, staleTimeMs, state.updatedAt]);

  useEffect(() => {
    if (!enabled || !refetchIntervalMs) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      void load<T>(path, true).catch(() => undefined);
    }, refetchIntervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, path, refetchIntervalMs]);

  const updateData: Dispatch<SetStateAction<T | null>> = useCallback(
    (value) => setCachedData<T>(path, value),
    [path]
  );

  const refetch = useCallback(() => load<T>(path, true), [path]);

  return { ...state, setData: updateData, refetch };
}
