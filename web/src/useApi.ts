import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tiny data-fetching hook. Encapsulates loading / error / data states and
 * cancels stale responses if the component unmounts mid-flight.
 *
 * Pass `fn` inline; React strict-mode double-invocation is harmless because
 * the second call's setState short-circuits via the cancellation flag.
 */
export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useApi<T>(fn: () => Promise<T>): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, loading, error, reload };
}
