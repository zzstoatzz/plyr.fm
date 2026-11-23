import type { ListSummary, Page, Track } from '../api.ts';
import { trackArtwork } from '../artwork.ts';
import { playlistIdFromUri } from '../record-ids.ts';

export interface OwnPlaylistsView { data: readonly ListSummary[]; cursor?: string; loading: boolean; error?: string }

type Entry = OwnPlaylistsView & { at: number; revision: number; request: number; busy: boolean };

const empty: OwnPlaylistsView = { data: [], loading: true };

/**
 * The signed-in account's playlists, for the "add to playlist" picker, kept for the session so the
 * picker opens on its list instead of loading it every time. The picker's own adds and creates
 * update it in place; any other change to the account's collections (seen through the catalog
 * revision) or ten minutes going by makes the next open check again, quietly, behind the list it has.
 */
export function createOwnPlaylists(options: {
  fetch: (did: string, cursor?: string) => Promise<Page<ListSummary>>;
  revision: (did: string) => number;
  now?: () => number;
  freshFor?: number;
}) {
  const now = options.now ?? Date.now;
  const freshFor = options.freshFor ?? 10 * 60_000;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const patch = (did: string, change: Partial<Entry>) => {
    const entry = entries.get(did);
    if (entry) { entries.set(did, { ...entry, ...change }); emit(); }
  };

  async function load(did: string, cursor?: string) {
    const entry = entries.get(did)!;
    const request = entry.request + 1;
    const revision = options.revision(did);
    // A first load shows that it is loading; checking again behind a list it already has does not.
    patch(did, { request, busy: true, loading: !entry.data.length || !!cursor, error: undefined });
    try {
      const page = await options.fetch(did, cursor);
      if (entries.get(did)?.request !== request) return;
      const data = cursor ? [...entries.get(did)!.data, ...page.data] : page.data;
      patch(did, { data, cursor: page.has_more ? page.next_cursor ?? undefined : undefined, loading: false, busy: false, at: cursor ? entries.get(did)!.at : now(), revision });
    } catch (failure) {
      if (entries.get(did)?.request !== request) return;
      patch(did, { loading: false, busy: false, error: entries.get(did)!.data.length && !cursor ? undefined : failure instanceof Error ? failure.message : 'could not load your playlists.' });
    }
  }

  function edit(did: string, change: (data: readonly ListSummary[]) => ListSummary[]) {
    const entry = entries.get(did);
    if (!entry) return;
    // This was the account's latest change, and it is already applied here.
    patch(did, { data: change(entry.data), revision: options.revision(did) });
  }

  return {
    snapshot: (did: string | null | undefined): OwnPlaylistsView => (did && entries.get(did)) || empty,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** The picker opened. */
    open(did: string) {
      const entry = entries.get(did);
      if (!entry) { entries.set(did, { ...empty, at: 0, revision: 0, request: 0, busy: false }); void load(did); return; }
      if (entry.busy) return;
      if (entry.error || options.revision(did) !== entry.revision || now() - entry.at > freshFor) void load(did);
    },
    more(did: string) {
      const entry = entries.get(did);
      if (entry?.cursor && !entry.busy) void load(did, entry.cursor);
    },
    /** After an error: a failed "more" asks for that page again, a failed first load starts over. */
    retry(did: string) {
      const entry = entries.get(did);
      if (entry && !entry.busy) void load(did, entry.data.length ? entry.cursor : undefined);
    },

    /** The track went into `uri`; 'present' changes nothing. */
    added(did: string, uri: string, track: Track) {
      edit(did, data => data.map(list => list.record.uri !== uri ? list : {
        ...list,
        media: list.media?.artwork ? list.media : { artwork: trackArtwork(track) ? { url: trackArtwork(track)! } : null },
        metrics: { ...list.metrics, member_count: list.metrics.member_count + 1, available_count: list.metrics.available_count + 1 }
      }));
    },
    /** A new playlist with this track in it goes to the top. */
    created(did: string, uri: string, name: string, track: Track) {
      const [, , collection = '', rkey = ''] = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri) ?? [];
      const art = trackArtwork(track);
      const list: ListSummary = {
        object: 'playlist', id: playlistIdFromUri(uri), record: { uri, cid: '', collection, rkey },
        metadata: { name, created_at: new Date(now()).toISOString(), updated_at: null },
        owner: { did, profile: null }, media: { artwork: art ? { url: art } : null },
        metrics: { member_count: 1, available_count: 1, total_plays: 0 }
      };
      edit(did, data => [list, ...data.filter(item => item.record.uri !== uri)]);
    },
    /** Sign-out or an account switch. */
    forget() { entries.clear(); emit(); }
  };
}

export type OwnPlaylists = ReturnType<typeof createOwnPlaylists>;
