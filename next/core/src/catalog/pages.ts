import type { Page } from '../api.ts';

type CatalogPage<T> = { data: T[]; cursor?: string; loading: boolean; error?: string };

export function createCatalogPages<T>(load: (cursor?: string) => Promise<Page<T>>, revision: () => number) {
  let view: CatalogPage<T> = { data: [], loading: true };
  let seen: number | undefined;
  let depth = 1;
  let request = 0;
  let connected = false;
  let active = false;
  let busy = false;
  let failed: 'refresh' | 'more' = 'refresh';
  const listeners = new Set<() => void>();

  function patch(change: Partial<CatalogPage<T>>) {
    view = { ...view, ...change };
    for (const listener of listeners) listener();
  }

  function activate(value: boolean) {
    active = value;
    if (active && seen !== revision()) void refresh();
  }

  function disconnect() {
    connected = active = busy = false;
    view = { ...view, loading: seen === undefined };
    request++;
  }

  async function run(mode: 'refresh' | 'more', work: (current: () => boolean) => Promise<void>) {
    if (!connected || busy) return;
    busy = true;
    const generation = ++request;
    const current = () => generation === request;
    patch({ loading: true, error: undefined });
    let succeeded = false;
    try {
      await work(current);
      succeeded = true;
    } catch (failure) {
      if (current()) {
        failed = mode;
        patch({ error: failure instanceof Error ? failure.message : 'could not load the catalog.' });
      }
    } finally {
      if (current()) {
        busy = false;
        patch({ loading: false });
        if (succeeded && active && seen !== revision()) queueMicrotask(() => void refresh());
      }
    }
  }

  function refresh() {
    return run('refresh', async current => {
      const revisionAtStart = revision();
      let cursor: string | undefined;
      const data: T[] = [];
      for (let page = 0; page < depth; page++) {
        const result = await load(cursor);
        if (!current()) return;
        data.push(...result.data);
        cursor = result.has_more ? result.next_cursor ?? undefined : undefined;
        if (!cursor) break;
      }
      seen = revisionAtStart;
      patch({ data, cursor });
    });
  }

  function more() {
    const cursor = view.cursor;
    if (!cursor) return;
    return run('more', async current => {
      const result = await load(cursor);
      if (!current()) return;
      depth++;
      patch({ data: [...view.data, ...result.data], cursor: result.has_more ? result.next_cursor ?? undefined : undefined });
    });
  }

  return {
    snapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    connect() { connected = true; },
    disconnect,
    activate,
    refresh,
    more,
    retry: () => failed === 'more' ? more() : refresh()
  };
}
