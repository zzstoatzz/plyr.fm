type Sync = { wanted: boolean; written: boolean };
export type LatestOutcome = { value: boolean; changed: boolean; failed: boolean; error?: unknown };

/**
 * Writes the newest wanted value of an on/off record, such as a like. A tap while a write is in
 * flight only moves the target and resolves undefined; the running writer catches up to the last
 * one, so quick taps never wait on the network or drop. The first tap resolves with where it settled.
 */
export function createLatestWriter() {
  const pending = new Map<string, Sync>();
  return {
    busy: (key: string) => pending.has(key),
    async want(key: string, from: boolean, wanted: boolean, write: (value: boolean) => Promise<unknown>): Promise<LatestOutcome | undefined> {
      const running = pending.get(key);
      if (running) { running.wanted = wanted; return undefined; }
      const sync: Sync = { wanted, written: from };
      pending.set(key, sync);
      let failed = false;
      let error: unknown;
      try {
        while (sync.wanted !== sync.written) {
          const target = sync.wanted;
          await write(target);
          sync.written = target;
        }
      } catch (failure) {
        failed = true;
        error = failure;
      } finally {
        pending.delete(key);
      }
      return { value: sync.written, changed: sync.written !== from, failed, error };
    }
  };
}
