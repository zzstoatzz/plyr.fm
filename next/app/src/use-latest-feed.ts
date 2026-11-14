import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { usePages } from './CatalogPieces';
import { discoveryFilter } from './discovery/preferences';
import { HOME_PAGE_SIZE, parseSelectedTags, selectedTagsKey } from './home-state';
import { readLocal, writeLocal } from './storage';
import { useHomeTags } from './use-home-tags';

/** Latest tracks, newest first, filtered by the tags this account picked on this device. */
export function useLatestFeed(hiddenTags: string[]) {
  const hiddenKey = JSON.stringify(hiddenTags);
  const { did } = useAuth();
  const key = selectedTagsKey(did);
  const [selection, setSelection] = useState(() => ({ key, tags: parseSelectedTags(readLocal(key)) }));
  const selected = selection.key === key ? selection.tags : parseSelectedTags(readLocal(key));
  const tagKey = JSON.stringify(selected);
  const loadLatest = useCallback((cursor?: string) => api.tracks({ limit: HOME_PAGE_SIZE, cursor, tag: parseSelectedTags(tagKey), hidden_tag: discoveryFilter(JSON.parse(hiddenKey)) }), [tagKey, hiddenKey]);
  const latest = usePages(loadLatest);
  const loaded = useMemo(() => [...new Map(latest.data.map(track => [track.id, track])).values()], [latest.data]);
  const pending = latest.loading && loaded.length === 0;
  const held = useRef(loaded);
  if (!pending) held.current = loaded;
  const tagPages = useHomeTags();
  function changeTags(next: string[]) {
    setSelection({ key, tags: next });
    writeLocal(key, JSON.stringify(next));
  }
  return { latest, tracks: pending ? held.current : loaded, pending, selected, changeTags, tagPages };
}

export type LatestFeed = ReturnType<typeof useLatestFeed>;
