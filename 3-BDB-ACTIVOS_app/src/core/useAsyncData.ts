import { useEffect, useState, type DependencyList } from "react";
import { toAppError, type AppError } from "./appError";

export interface AsyncDataState<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  retry: () => void;
}

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: DependencyList,
  options: { enabled?: boolean; initialData?: T | null } = {}
): AsyncDataState<T> {
  const { enabled = true, initialData = null } = options;
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    loader()
      .then((nextData) => {
        if (active) {
          setData(nextData);
        }
      })
      .catch((err) => {
        if (active) {
          setError(toAppError(err));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, retryCount]);

  return { data, error, loading, retry: () => setRetryCount((count) => count + 1) };
}
