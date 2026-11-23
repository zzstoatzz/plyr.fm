import { findAudioGaps, moveAudioGap, type AudioGap, type GapContext } from './pds-audio-gaps.ts';
import type { RepoRpc } from './repo-rpc.ts';
import type { Did } from '../auth-state.ts';

export type RowState = 'waiting' | 'moving' | 'moved' | 'too-big' | 'no-copy' | 'failed';
export interface GapRow { state: RowState; progress: number; error?: string }

export interface PdsAudioSnapshot {
  gaps: AudioGap[];
  /** the gaps a move can fix (not over 100 MB) */
  fixable: AudioGap[];
  rows: Record<string, GapRow>;
  moving: boolean;
  finished: boolean;
  /** the card on the you page: something to move (not put off), or a move to report */
  showCard: boolean;
  /** the one-time ask after sign-in */
  showSheet: boolean;
}

type Account = { did: Did | null; rpc: RepoRpc | null; ready: boolean };

/**
 * One account's audio that isn't on its PDS, and the move that puts it there. One store per app, so the
 * sign-in ask and the card on the you page share a single check, and a move keeps going across screens.
 * "not now" lasts until the set of tracks changes; the sign-in ask is shown once per account per device.
 */
export function createPdsAudioStore({ getAuth, subscribeAuth, collection, pdsEndpoint, storage, onMoved, fetcher }: {
  getAuth: () => Account;
  subscribeAuth: (listener: () => void) => unknown;
  collection: GapContext['collection'];
  pdsEndpoint: (did: string) => Promise<string>;
  storage: { read(key: string): string | null; write(key: string, value: string): void };
  /** after a move, so catalogs reload */
  onMoved?: (did: string) => void;
  fetcher?: typeof fetch;
}) {
  let did: string | null = null;
  let gaps: AudioGap[] = [];
  let checked = false, moving = false, finished = false, asked = true;
  let rows: Record<string, GapRow> = {};
  let dismissed: string | null = null;
  let run = 0;
  let snapshot: PdsAudioSnapshot;
  const listeners = new Set<() => void>();

  const key = (kind: 'dismissed' | 'asked', account: string) => `plyr.pds-audio.${kind}.${account}`;
  const fixable = () => gaps.filter(gap => !gap.tooBig);
  const signature = () => fixable().map(gap => gap.uri).sort().join(' ');

  function emit() {
    const can = fixable();
    const offer = checked && can.length > 0 && dismissed !== signature();
    snapshot = { gaps, fixable: can, rows, moving, finished, showCard: moving || finished || offer, showSheet: offer && !asked && !moving && !finished };
    for (const listener of listeners) listener();
  }
  emit();

  function reset() { run++; did = null; checked = false; finished = false; gaps = []; rows = {}; }

  subscribeAuth(() => { if (getAuth().did !== did && !moving) { reset(); emit(); } });

  async function check() {
    const account = getAuth();
    if (!account.ready || !account.did || !account.rpc || moving) return;
    if (did === account.did && checked) return;
    const mine = ++run, owner = account.did;
    did = owner; checked = false; finished = false; gaps = []; rows = {};
    dismissed = storage.read(key('dismissed', owner));
    asked = storage.read(key('asked', owner)) === '1';
    emit();
    try {
      const found = await findAudioGaps({ rpc: account.rpc, did: owner, collection, pds: await pdsEndpoint(owner), fetcher });
      if (mine !== run || getAuth().did !== owner) return;
      gaps = found; checked = true;
      emit();
    } catch {
      // a PDS that can't be read right now just means no prompt this time
    }
  }

  async function moveAll() {
    const account = getAuth();
    if (!account.did || !account.rpc || moving || account.did !== did) return;
    const owner = account.did, rpc = account.rpc;
    moving = true; finished = false; emit();
    const settled = (gap: AudioGap) => gap.tooBig || ['moved', 'too-big', 'no-copy'].includes(rows[gap.uri]?.state ?? '');
    const todo = gaps.filter(gap => !settled(gap));
    rows = { ...rows, ...Object.fromEntries(gaps.filter(gap => !settled(gap) || gap.tooBig).map(gap => [gap.uri, { state: gap.tooBig ? 'too-big' : 'waiting', progress: 0 } satisfies GapRow])) };
    emit();
    const set = (uri: string, row: GapRow) => { rows = { ...rows, [uri]: row }; emit(); };
    const assertSession = () => { const now = getAuth(); if (now.did !== owner || now.rpc !== rpc) throw new Error('you signed out before this finished.'); };
    try {
      const ctx = { rpc, did: owner, collection, pds: await pdsEndpoint(owner), fetcher };
      let next = 0;
      // two at a time: each file passes through this device, so more would only split the bandwidth
      await Promise.all([0, 1].map(async () => {
        while (next < todo.length) {
          const gap = todo[next++];
          set(gap.uri, { state: 'moving', progress: 0 });
          let shown = 0;
          try {
            const result = await moveAudioGap(ctx, gap, { assertSession, onProgress: progress => {
              // a progress bar doesn't need every chunk
              if (progress - shown < 0.02 && progress < 1) return;
              shown = progress; set(gap.uri, { state: 'moving', progress });
            } });
            set(gap.uri, { state: result === 'already' ? 'moved' : result, progress: 1 });
          } catch (failure) {
            set(gap.uri, { state: 'failed', progress: 0, error: failure instanceof Error ? failure.message : 'something went wrong.' });
          }
        }
      }));
    } catch (failure) {
      for (const gap of todo) if (rows[gap.uri]?.state === 'waiting') rows = { ...rows, [gap.uri]: { state: 'failed', progress: 0, error: failure instanceof Error ? failure.message : undefined } };
    }
    moving = false; finished = true;
    if (getAuth().did === owner) onMoved?.(owner);
    else reset();
    emit();
  }

  function markAsked() {
    if (!did || asked) return;
    asked = true;
    storage.write(key('asked', did), '1');
    emit();
  }

  /** "not now": hidden until something else goes missing */
  function dismiss() {
    if (!did) return;
    dismissed = signature();
    storage.write(key('dismissed', did), dismissed);
    asked = true;
    storage.write(key('asked', did), '1');
    emit();
  }

  /** closes the finished summary; what couldn't move is offered again only once the set of tracks changes */
  function close() {
    gaps = gaps.filter(gap => rows[gap.uri]?.state !== 'moved');
    rows = {}; finished = false;
    if (fixable().length) dismiss();
    else emit();
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get snapshot() { return snapshot; },
    check, moveAll, dismiss, markAsked, close
  };
}

export type PdsAudioStore = ReturnType<typeof createPdsAudioStore>;

export function offerCopy(count: number) {
  return count === 1
    ? { title: "one of your tracks isn't on your PDS", detail: 'plyr.fm can put it there now. it keeps playing the whole time.' }
    : { title: `${count} of your tracks aren't on your PDS`, detail: 'plyr.fm can put them there now. they keep playing the whole time.' };
}

export const sheetCopy = (count: number) => ({
  title: "some of your audio isn't on your PDS",
  detail: `${count === 1 ? "one of your tracks isn't" : `${count} of your tracks aren't`} on your PDS right now. plyr.fm can put ${count === 1 ? 'it' : 'them'} there, where the rest of your stuff lives. ${count === 1 ? 'it keeps' : 'they keep'} playing the whole time.`
});

export const apology = 'sometimes a bug on our side or a hiccup at your PDS host leaves audio behind. sorry about that.';

export const movingCopy = (snapshot: PdsAudioSnapshot) => {
  const total = snapshot.fixable.length;
  const done = snapshot.fixable.filter(gap => snapshot.rows[gap.uri]?.state === 'moved').length;
  return { title: `moving ${total === 1 ? 'your track' : `${total} tracks`} to your PDS`, detail: `${done} of ${total} done. you can leave this page, it keeps going.` };
};

export function resultCopy(snapshot: Pick<PdsAudioSnapshot, 'fixable' | 'rows'>) {
  const count = (state: RowState) => snapshot.fixable.filter(gap => snapshot.rows[gap.uri]?.state === state).length;
  const moved = count('moved'), tooBig = count('too-big'), noCopy = count('no-copy'), failed = count('failed');
  const stuck = snapshot.fixable.length - moved;
  if (!stuck) return { allMoved: true, retry: false, title: "everything's on your PDS now", detail: `${moved === 1 ? '1 track' : `${moved} tracks`} moved.` };
  const title = moved ? `${moved} moved, ${stuck} couldn't` : stuck === 1 ? "this one couldn't move" : `these ${stuck} couldn't move`;
  const detail = [
    tooBig && "your PDS won't take files over 100 MB, so plyr.fm keeps those. they play the same either way.",
    noCopy && 'plyr.fm has no copy of what your PDS lost. replacing the audio fixes it.',
    failed && 'something went wrong partway. trying again picks up where it stopped.'
  ].filter(Boolean).join(' ');
  return { allMoved: false, retry: failed > 0, title, detail };
}

export const gapReason = (gap: AudioGap) => gap.tooBig ? 'too big for your PDS' : gap.kind === 'lost' ? 'your PDS lost this file' : 'only on plyr.fm';

export const gapSize = (bytes?: number) => bytes === undefined ? '' : bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
