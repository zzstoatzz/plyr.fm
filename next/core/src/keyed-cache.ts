/**
 * Remembers answers by key for the session, so a sheet or panel that mounts again shows what it had
 * at once instead of asking again. One request per key at a time; a failure is not remembered.
 */
export function createKeyedCache<V>(fetch: (key: string) => Promise<V>, options: { max?: number; freshFor?: number; now?: () => number } = {}) {
  const max = options.max ?? 200;
  const freshFor = options.freshFor ?? Infinity;
  const now = options.now ?? Date.now;
  const values = new Map<string, { value: V; at: number }>();
  const fresh = (key: string) => { const entry = values.get(key); return entry && now() - entry.at <= freshFor ? entry : undefined; };
  const pending = new Map<string, Promise<V>>();
  return {
    /** The last answer, even a stale one: a sheet shows it while `load` checks again. */
    peek: (key: string) => values.get(key)?.value,
    load(key: string): Promise<V> {
      const entry = fresh(key);
      if (entry) return Promise.resolve(entry.value);
      const inflight = pending.get(key);
      if (inflight) return inflight;
      const request = fetch(key).then(value => {
        values.delete(key);
        values.set(key, { value, at: now() });
        if (values.size > max) values.delete(values.keys().next().value!);
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    }
  };
}
