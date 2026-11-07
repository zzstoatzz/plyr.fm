import type { Page } from './api';

export class QueueContinuation<T extends { id: string }> {
  private cursor: string | undefined;
  private exhausted = false;
  private buffer: T[] = [];
  private pending?: Promise<void>;
  private generation = 0;
  private controller?: AbortController;
  private readonly fetch: (cursor?: string, signal?: AbortSignal) => Promise<Page<T>>;

  constructor(fetch: (cursor?: string, signal?: AbortSignal) => Promise<Page<T>>) { this.fetch = fetch; }
  reset(cursor?: string | null) {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    this.cursor = cursor ?? undefined;
    this.exhausted = false;
    this.buffer = [];
    this.pending = undefined;
  }
  async prefetch(seen: Set<string>) {
    if (this.pending) return this.pending;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const fill = async () => {
      this.buffer = this.buffer.filter(track => !seen.has(track.id));
      for (let page = 0; page < 3 && this.buffer.length < 10 && !this.exhausted; page++) {
        const previous = this.cursor;
        const result = await this.fetch(previous, controller.signal);
        if (generation !== this.generation) return;
        const next = result.next_cursor ?? undefined;
        this.exhausted = !result.has_more || !next || next === previous;
        this.cursor = next;
        const known = new Set([...seen, ...this.buffer.map(track => track.id)]);
        this.buffer.push(...result.data.filter(track => { if (known.has(track.id)) return false; known.add(track.id); return true; }));
      }
    };
    const pending = fill().catch(error => { if (generation === this.generation) throw error; }).finally(() => { if (generation === this.generation) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }
  peek(seen: Set<string>) { return this.buffer.filter(track => !seen.has(track.id)).slice(0, 30); }
  consumed(ids: Set<string>) { this.buffer = this.buffer.filter(track => !ids.has(track.id)); }
  get nextCursor() { return this.cursor ?? null; }
}
