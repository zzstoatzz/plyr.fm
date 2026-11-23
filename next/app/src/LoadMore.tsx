import { useCallback, useContext, useEffect, useRef } from 'react';
import { Action } from './controls';
import { ScrollEdge } from './behaviors/scroll-edge';

/**
 * The end of a paged list. It asks for the next page whenever the surrounding scroll view nears its end and
 * nothing is loading or failed; the list's own status shows the loading and the retry. Outside such a scroll
 * view it falls back to a plain button.
 */
export function LoadMore({ more, loading = false, error, load }: { more: unknown; loading?: boolean; error?: unknown; load: () => unknown }) {
  const edge = useContext(ScrollEdge);
  const state = useRef({ more, loading, error, load });
  state.current = { more, loading, error, load };
  const check = useCallback(() => {
    const { more, loading, error, load } = state.current;
    if (more && !loading && !error && edge?.near()) load();
  }, [edge]);
  useEffect(() => edge?.watch(check), [edge, check]);
  // a page that settles with the end still in view asks for the next one straight away
  useEffect(check, [check, more, loading, error]);
  return !edge && more && !loading && !error ? <Action label="load more" onPress={() => void load()} /> : null;
}
