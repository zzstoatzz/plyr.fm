import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from './api';
import { catalogRevision, type CatalogScope } from './catalog-changes';
import { errorMessage } from './CatalogPieces';

export function usePortalPages<T>(did: string, scope: CatalogScope, load: (cursor?: string) => Promise<Page<T>>, active: boolean) {
  const [data, setData] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const busy = useRef(false);
  const focused = useRef(false);
  const mounted = useRef(false);
  const depth = useRef(1);
  const failed = useRef<'refresh' | 'more'>('refresh');
  const seen = useRef(catalogRevision(did, scope));
  const refresh = useCallback(async (): Promise<void> => {
    if (!mounted.current || busy.current) return;
    busy.current = true;
    const request = generation.current;
    const revision = catalogRevision(did, scope);
    let succeeded = false;
    setLoading(true); setError(undefined);
    try {
      let next: string | undefined;
      const records: T[] = [];
      for (let page = 0; page < depth.current; page++) {
        const result = await load(next);
        if (request !== generation.current) return;
        records.push(...result.data);
        next = result.has_more ? result.next_cursor ?? undefined : undefined;
        if (!next) break;
      }
      setData(records); setCursor(next);
      seen.current = revision;
      succeeded = true;
    } catch (failure) { if (request === generation.current) { failed.current = 'refresh'; setError(errorMessage(failure)); } }
    finally { if (request === generation.current) {
      busy.current = false; setLoading(false);
      if (succeeded && focused.current && seen.current !== catalogRevision(did, scope)) queueMicrotask(() => void refresh());
    } }
  }, [did, scope, load]);
  const more = useCallback(async () => {
    if (!mounted.current || busy.current || !cursor) return;
    busy.current = true;
    const request = generation.current;
    let succeeded = false;
    setLoading(true); setError(undefined);
    try {
      const page = await load(cursor);
      if (request !== generation.current) return;
      depth.current++;
      setData(previous => [...previous, ...page.data]);
      setCursor(page.has_more ? page.next_cursor ?? undefined : undefined);
      succeeded = true;
    } catch (failure) { if (request === generation.current) { failed.current = 'more'; setError(errorMessage(failure)); } }
    finally { if (request === generation.current) {
      busy.current = false; setLoading(false);
      if (succeeded && focused.current && seen.current !== catalogRevision(did, scope)) queueMicrotask(() => void refresh());
    } }
  }, [cursor, load, did, scope, refresh]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; generation.current++; busy.current = false; };
  }, [refresh]);
  useFocusEffect(useCallback(() => {
    focused.current = active;
    if (active && seen.current !== catalogRevision(did, scope)) void refresh();
    return () => { focused.current = false; };
  }, [did, scope, refresh, active]));
  return { data, cursor, loading, error, more, reload: refresh, retry: () => failed.current === 'more' ? more() : refresh() };
}
