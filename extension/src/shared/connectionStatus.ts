import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';

/**
 * Lightweight hook that tracks whether the backend server is reachable.
 *
 * It checks once on mount and then re-checks periodically (every 30 s by
 * default).  Components can also call `recheckNow()` to trigger an immediate
 * probe — e.g. after a network error during a normal API call.
 */
export function useConnectionStatus(intervalMs = 30_000) {
  const [online, setOnline] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      await api.health();
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void check();
    timerRef.current = setInterval(() => void check(), intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [check, intervalMs]);

  const recheckNow = useCallback(() => void check(), [check]);

  return { online, recheckNow };
}
