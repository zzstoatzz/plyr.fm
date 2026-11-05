import { useEffect, useState } from 'react';
import { api, type SearchHit } from './api';
import { errorMessage } from './CatalogPieces';

export function useSearch(query: string, type: SearchHit['type'] | undefined, limit: number) {
  const key = JSON.stringify([query, type]);
  const [attempt, retry] = useState(0);
  const [state, setState] = useState<{ key: string; data?: SearchHit[]; error?: string; loading: boolean }>({ key, loading: false });
  const enabled = Array.from(query).length >= 2;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, loading: true }));
    const timer = setTimeout(() => {
      void api.search(query, { types: type, limit, signal: controller.signal }).then(page => {
        if (!controller.signal.aborted) setState({ key, data: page.data, loading: false });
      }, error => {
        if (!controller.signal.aborted) setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, error: errorMessage(error), loading: false }));
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, type, limit, key, enabled, attempt]);
  const current = state.key === key && enabled;
  return { data: current ? state.data : undefined, error: current ? state.error : undefined, loading: enabled && (!current || state.loading), retry: () => retry(value => value + 1) };
}
