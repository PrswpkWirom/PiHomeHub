import { useCallback, useEffect, useRef, useState } from "react";

export const PORT_POLL_INTERVAL_MS = 5_000;
export const PORT_POLL_TIMEOUT_MS = 120_000;

export function usePendingPortPolling(pendingSlugs: string[], poll: () => Promise<unknown>) {
  const deadlines = useRef<Map<string, number>>(new Map());
  const inFlight = useRef(false);
  const [expiredSlugs, setExpiredSlugs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const pendingKey = [...pendingSlugs].sort().join(",");

  const runPoll = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      await poll();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Port status check failed.");
      throw reason;
    } finally {
      inFlight.current = false;
    }
  }, [poll]);

  useEffect(() => {
    const pending = new Set(pendingSlugs);
    for (const slug of deadlines.current.keys()) {
      if (!pending.has(slug)) {
        deadlines.current.delete(slug);
      }
    }
    setExpiredSlugs((current) => new Set([...current].filter((slug) => pending.has(slug))));
    if (!pendingSlugs.length) {
      setError(null);
      return;
    }

    const now = Date.now();
    for (const slug of pendingSlugs) {
      if (!deadlines.current.has(slug)) {
        deadlines.current.set(slug, now + PORT_POLL_TIMEOUT_MS);
      }
    }

    const interval = window.setInterval(() => {
      const currentTime = Date.now();
      const expired = pendingSlugs.filter((slug) => (deadlines.current.get(slug) ?? 0) <= currentTime);
      if (expired.length) {
        setExpiredSlugs((current) => new Set([...current, ...expired]));
      }
      if (expired.length === pendingSlugs.length) {
        window.clearInterval(interval);
        return;
      }
      void runPoll().catch(() => undefined);
    }, PORT_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [pendingKey, runPoll]);

  return { expiredSlugs, error, retry: runPoll };
}
