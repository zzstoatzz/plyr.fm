/**
 * Wraps an async `send` so calls never overlap: while one is in flight, only the newest
 * waiting value is kept and sent next.
 */
export function latestOnly<T>(send: (value: T) => Promise<unknown>): (value: T) => void {
  let busy = false;
  let waiting: { value: T } | null = null;
  const drain = async () => {
    busy = true;
    while (waiting) {
      const { value } = waiting;
      waiting = null;
      try {
        await send(value);
      } catch {
        // the next value is still worth sending
      }
    }
    busy = false;
  };
  return (value) => {
    waiting = { value };
    if (!busy) void drain();
  };
}
