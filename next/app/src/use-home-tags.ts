import { useCallback, useEffect, useRef, useState } from 'react';
import { homeTags, type HomeTag } from './home-api';
import { errorMessage } from './CatalogPieces';

export function useHomeTags() {
  const [tags, setTags] = useState<HomeTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [hasMore, setHasMore] = useState(true);
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const cursor = useRef<string | undefined>(undefined);
  const done = useRef(false);
  const failed = useRef(false);
  const seen = useRef(new Set<string>());
  const more = useCallback(async (retry = false) => {
    if (!lifetime.current || pending.current || done.current || failed.current && !retry) return;
    const owner = lifetime.current;
    const request = new AbortController();
    const abort = () => request.abort();
    owner.signal.addEventListener('abort', abort, { once: true });
    pending.current = true;
    failed.current = false;
    setLoading(true);
    setError(undefined);
    const timer = setTimeout(abort, 15_000);
    try {
      const page = await homeTags(request.signal, cursor.current);
      if (owner.signal.aborted) return;
      if (page.nextCursor && seen.current.has(page.nextCursor)) throw new Error('tag pagination did not advance');
      if (page.nextCursor) seen.current.add(page.nextCursor);
      cursor.current = page.nextCursor;
      done.current = !page.nextCursor;
      setHasMore(!done.current);
      setTags(previous => [...new Map([...previous, ...page.data].map(tag => [tag.name, tag])).values()]);
    } catch (cause) {
      if (!owner.signal.aborted) { failed.current = true; setError(request.signal.aborted ? 'could not load tags' : errorMessage(cause)); }
    } finally {
      clearTimeout(timer);
      owner.signal.removeEventListener('abort', abort);
      if (!owner.signal.aborted) { pending.current = false; setLoading(false); }
    }
  }, []);
  useEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    pending.current = false;
    void more();
    return () => { owner.abort(); lifetime.current = null; };
  }, [more]);
  return { tags, loading, error, hasMore, more, retry: () => void more(true) };
}
