import { catalogChanged } from '@plyr/next-core/catalog/changes';
import { pdsEndpoint } from '@plyr/next-core/identity';
import { findAudioGaps, moveAudioGap, type AudioGap, type GapContext } from '@plyr/next-core/publishing/pds-audio-gaps';
import { auth } from '$lib/auth';
import { authConfig } from '$lib/auth-config';

export type RowState = 'waiting' | 'moving' | 'moved' | 'too-big' | 'no-copy' | 'failed';

/**
 * Tracks whose audio isn't on the signed-in account's PDS, and the move that puts it there.
 * One instance for the app, so the card on the you page and the sign-in sheet share a single
 * check and a move keeps going when you leave the page.
 */
function createPdsAudio() {
  let did = $state<string | null>(null);
  let gaps = $state.raw<AudioGap[]>([]);
  let checked = $state(false);
  let moving = $state(false);
  let finished = $state(false);
  let rows = $state<Record<string, { state: RowState; progress: number; error?: string }>>({});
  let dismissedKey = $state<string | null>(null);
  let asked = $state(true);
  let run = 0;

  const fixable = $derived(gaps.filter(gap => !gap.tooBig));
  const signature = $derived(fixable.map(gap => gap.uri).sort().join(' '));
  const storageKey = (kind: 'dismissed' | 'asked', account: string) => `plyr.pds-audio.${kind}.${account}`;
  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

  function context(): GapContext & { did: `did:${string}:${string}` } | undefined {
    const account = auth.getAuth();
    if (!account.did || !account.rpc) return;
    return { rpc: account.rpc, did: account.did, collection: authConfig.NSID.track as GapContext['collection'], pds: '' };
  }

  async function check() {
    const account = auth.getAuth();
    if (!account.ready || !account.did || !account.rpc || moving) return;
    if (did === account.did && checked) return;
    const mine = ++run;
    did = account.did; checked = false; finished = false; gaps = []; rows = {};
    dismissedKey = read(storageKey('dismissed', account.did));
    asked = read(storageKey('asked', account.did)) === '1';
    try {
      const ctx = context();
      if (!ctx) return;
      const found = await findAudioGaps({ ...ctx, pds: await pdsEndpoint(ctx.did) });
      if (mine !== run || auth.getAuth().did !== did) return;
      gaps = found;
      checked = true;
    } catch {
      // a PDS that can't be read right now just means no prompt this time
    }
  }

  async function moveAll() {
    const ctx = context();
    if (!ctx || moving || ctx.did !== did) return;
    const owner = ctx.did, rpc = ctx.rpc;
    const pds = await pdsEndpoint(owner);
    moving = true; finished = false;
    const settled = (gap: AudioGap) => gap.tooBig || ['moved', 'too-big', 'no-copy'].includes(rows[gap.uri]?.state ?? '');
    const todo = gaps.filter(gap => !settled(gap));
    rows = { ...rows, ...Object.fromEntries(gaps.map(gap => [gap.uri, gap.tooBig ? { state: 'too-big' as const, progress: 0 } : settled(gap) ? rows[gap.uri] : { state: 'waiting' as const, progress: 0 }])) };
    const assertSession = () => { const now = auth.getAuth(); if (now.did !== owner || now.rpc !== rpc) throw new Error('you signed out before this finished.'); };
    let next = 0;
    // two at a time: each file passes through this device, so more would only split the bandwidth
    await Promise.all([0, 1].map(async () => {
      while (next < todo.length) {
        const gap = todo[next++];
        rows[gap.uri] = { state: 'moving', progress: 0 };
        try {
          const result = await moveAudioGap({ ...ctx, pds }, gap, { assertSession, onProgress: progress => { rows[gap.uri].progress = progress; } });
          rows[gap.uri] = { state: result === 'already' ? 'moved' : result, progress: 1 };
        } catch (failure) {
          rows[gap.uri] = { state: 'failed', progress: 0, error: failure instanceof Error ? failure.message : 'something went wrong.' };
        }
      }
    }));
    moving = false; finished = true;
    if (auth.getAuth().did === owner) catalogChanged(owner, 'tracks');
  }

  /** "not now": hidden until something else goes missing */
  function dismiss() {
    if (!did) return;
    dismissedKey = signature;
    write(storageKey('dismissed', did), signature);
    markAsked();
  }

  function markAsked() {
    if (!did) return;
    asked = true;
    write(storageKey('asked', did), '1');
  }

  /** closes the finished summary; whatever couldn't move is offered again only if it changes */
  function close() {
    const left = gaps.filter(gap => rows[gap.uri]?.state !== 'moved');
    gaps = left;
    rows = {};
    finished = false;
    if (left.some(gap => !gap.tooBig)) dismiss();
  }

  auth.subscribe(() => { if (auth.getAuth().did !== did) { run++; did = null; checked = false; gaps = []; rows = {}; finished = false; } });

  return {
    get gaps() { return gaps; },
    get fixable() { return fixable; },
    get rows() { return rows; },
    get moving() { return moving; },
    get finished() { return finished; },
    /** the card shows while there's something to move (and it wasn't put off), or a move to report */
    get showCard() { return moving || finished || (checked && fixable.length > 0 && dismissedKey !== signature); },
    /** the one-time sheet after sign-in */
    get showSheet() { return checked && !asked && !moving && !finished && fixable.length > 0 && dismissedKey !== signature; },
    check, moveAll, dismiss, markAsked, close
  };
}

export const pdsAudio = createPdsAudio();
