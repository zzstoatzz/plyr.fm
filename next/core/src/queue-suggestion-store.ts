import type { Track } from './api.ts';
import { loadStarter, starters, suggestionRequest, type StarterKey } from './queue-suggestions.ts';

type Api = Parameters<typeof loadStarter>[0];

export type StackState = { tracks: Track[]; label: string } | 'loading' | 'failed';

export interface QueueSuggestionsState {
  /** "add to your queue": suggestions for the track that was playing when they were asked for. */
  picks: readonly Track[];
  /** "more from <artist>": the playing artist's other tracks that were not queued yet. */
  more: readonly Track[];
  moreName: string;
  /** Cards the listener added; they stay out of both strips. */
  added: ReadonlySet<string>;
  /** The empty queue's stacks, for the account in `stacksFor`. */
  stacks: Readonly<Partial<Record<StarterKey, StackState>>>;
  started: ReadonlySet<StarterKey>;
}

export interface PlayingContext {
  uri?: string;
  artistDid?: string;
  artistName: string;
  /** Read when a request goes out, so a queue edit alone never refetches. */
  queue: () => { queue: readonly Track[]; index: number };
}

const stackFreshFor = 10 * 60_000;
const settleFor = 300;

/**
 * The queue's suggestions, kept for the whole session rather than per panel: they follow the playing
 * track and artist, so opening and closing the queue shows the last strips at once and asks for nothing.
 * They refetch only when the playing context changes, on refresh, or (stacks) once they go stale or are used.
 */
export function createQueueSuggestions(api: Api, options: { now?: () => number; random?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let state: QueueSuggestionsState = { picks: [], more: [], moreName: '', added: new Set(), stacks: {}, started: new Set() };
  const emit = (next: Partial<QueueSuggestionsState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };

  let picksFor: string | undefined;
  let picksRequest: AbortController | undefined;
  let picksTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: string[] = [];
  let moreFor: string | undefined;
  let moreRequest: AbortController | undefined;
  let latest: PlayingContext | undefined;

  function askPicks(context: PlayingContext, round: boolean, wait: number) {
    clearTimeout(picksTimer);
    picksRequest?.abort();
    const uri = context.uri;
    picksFor = uri;
    if (!uri) return;
    const controller = picksRequest = new AbortController();
    // Skipping through tracks quickly asks once, for the one that stays.
    picksTimer = setTimeout(() => {
      const { queue, index } = context.queue();
      const request = suggestionRequest(queue, index, round ? shown : []);
      if (!request) { picksFor = undefined; return; }
      api.suggestions(request.seeds, { exclude: request.exclude, limit: 12, signal: controller.signal }).then(result => {
        if (controller.signal.aborted) return;
        shown = [...result.data.map(track => track.record.uri), ...(round ? shown : [])].slice(0, 60);
        emit({ picks: result.data });
      }, () => { if (picksRequest === controller && !controller.signal.aborted) picksFor = undefined; });
    }, wait);
  }

  function askMore(context: PlayingContext) {
    moreRequest?.abort();
    const did = moreFor = context.artistDid;
    if (!did) { emit({ more: [], moreName: '' }); return; }
    const controller = moreRequest = new AbortController();
    const name = context.artistName;
    api.tracks({ artist_did: did, limit: 13 }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const queued = new Set(context.queue().queue.map(track => track.id));
      emit({ more: result.data.filter(track => !queued.has(track.id)).slice(0, 12), moreName: name });
    }, () => { if (moreRequest === controller && !controller.signal.aborted) moreFor = undefined; });
  }

  let stacksFor: string | null | undefined;
  const stackAt: Partial<Record<StarterKey, number>> = {};
  const attempts: Partial<Record<StarterKey, number>> = {};

  function loadStack(key: StarterKey) {
    const attempt = attempts[key] = (attempts[key] ?? 0) + 1;
    const did = stacksFor ?? undefined;
    const settle = (value: StackState) => {
      if (attempts[key] !== attempt) return;
      if (typeof value === 'object') stackAt[key] = now();
      emit({ stacks: { ...state.stacks, [key]: value } });
    };
    // A stale stack stays on screen while its replacement loads.
    if (typeof state.stacks[key] !== 'object') emit({ stacks: { ...state.stacks, [key]: 'loading' } });
    loadStarter(api, key, did, options.random).then(settle, () => settle(typeof state.stacks[key] === 'object' ? state.stacks[key] : 'failed'));
  }

  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** Called whenever the queue panel shows strips: asks only when the playing track or artist differs from last time. */
    follow(context: PlayingContext) {
      latest = context;
      if (context.uri !== picksFor) askPicks(context, false, settleFor);
      if (context.artistDid !== moreFor) askMore(context);
    },
    /** Other suggestions for the same track, never repeating ones already shown. */
    refresh() { if (latest) askPicks(latest, true, 0); },
    added(id: string) { emit({ added: new Set([...state.added, id]) }); },

    /**
     * Called when the empty queue shows its stacks. A new account gets its own; a stack that was used or
     * has gone stale is fetched again (keeping its covers up until the new ones land); the rest show as they were.
     */
    showStacks(did: string | null | undefined) {
      if (did !== stacksFor) {
        stacksFor = did;
        for (const key in attempts) attempts[key as StarterKey]! += 1;
        for (const key in stackAt) delete stackAt[key as StarterKey];
        emit({ stacks: {}, started: new Set() });
      }
      const used = state.started;
      if (used.size) emit({ started: new Set() });
      for (const starter of starters(!!did)) {
        const stack = state.stacks[starter.key];
        const stale = typeof stack === 'object' && now() - (stackAt[starter.key] ?? 0) > stackFreshFor;
        if (!stack || stack === 'failed' || stale || used.has(starter.key)) loadStack(starter.key);
      }
    },
    reloadStack: loadStack,
    started(key: StarterKey) { emit({ started: new Set([...state.started, key]) }); }
  };
}

export type QueueSuggestions = ReturnType<typeof createQueueSuggestions>;
