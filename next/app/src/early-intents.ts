import type { Track } from './api';

export type EarlyIntent = { kind: 'play'; track: Track; collection?: Track[]; label?: string } | { kind: 'enqueue'; track: Track };
type EarlyPlay = Extract<EarlyIntent, { kind: 'play' }>;

/** How long a play waits for the account queue to start before it plays on this device instead. */
export const EARLY_PLAY_LIMIT_MS = 6_000;

/**
 * Intents made before the account's queue session has started. A play holds the
 * player in its loading state, so it carries a deadline: if the session hasn't
 * started by then (a stalled sign-in restore, or a session that failed to start),
 * the play is handed to `expire` and leaves the queue instead of spinning forever.
 */
export class EarlyIntents {
  private intents: EarlyIntent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly expire: (intent: EarlyPlay) => void;
  private readonly limit: number;

  constructor(expire: (intent: EarlyPlay) => void, limit = EARLY_PLAY_LIMIT_MS) {
    this.expire = expire;
    this.limit = limit;
  }

  get length() { return this.intents.length; }
  hasPlay() { return this.intents.some(intent => intent.kind === 'play'); }

  /** Replaces any earlier play, and restarts the deadline. */
  play(intent: Omit<EarlyPlay, 'kind'>) {
    this.intents = this.intents.filter(item => item.kind !== 'play');
    const play: EarlyPlay = { kind: 'play', ...intent };
    this.intents.push(play);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.intents.includes(play)) return;
      this.intents = this.intents.filter(item => item !== play);
      this.expire(play);
    }, this.limit);
  }

  enqueue(track: Track, cap = 64) {
    if (this.intents.length < cap) this.intents.push({ kind: 'enqueue', track });
  }

  /** Every pending intent, in order; the queue is empty afterwards. */
  drain(): EarlyIntent[] {
    clearTimeout(this.timer);
    this.timer = undefined;
    return this.intents.splice(0);
  }
}
