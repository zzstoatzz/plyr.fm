import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import { accessGroup, facets, filterTracks, loadAll, matchRange } from '../src/catalog/owned.ts';

const track = (title: string, extra: { album?: string; tags?: string[]; plays?: number; at?: string; label?: string } = {}) => ({
  object: 'track', id: title, record: { uri: `at://did:plc:a/fm.plyr.track/${title}`, cid: null, revision: null, collection: 'fm.plyr.track', rkey: title },
  metadata: { title, description: null, album: extra.album ?? null, duration_seconds: null, created_at: extra.at ?? '2026-01-01', tags: extra.tags },
  artist: { did: 'did:plc:a', profile: { handle: 'a', display_name: 'a', avatar_url: null } },
  media: {}, access: { visibility: 'public' }, metrics: { play_count: extra.plays ?? 0, like_count: 0 }, label: extra.label ?? 'everyone'
}) as Track & { label: string };

const label = (t: Track) => (t as Track & { label: string }).label;
const all = [
  track('grape light', { album: 'snacks', tags: ['piano'], plays: 412, at: '2026-10-30' }),
  track('banana hour', { album: 'lake tapes', tags: ['field recording'], plays: 96, at: '2026-10-11' }),
  track('berry tape', { plays: 0, at: '2026-11-19', label: 'only you' }),
  track('plum, slowly', { tags: ['ambient'], plays: 188, at: '2026-10-22', label: 'anyone with the link' })
];
const titles = (list: Track[]) => list.map(t => t.metadata.title);

test('search covers title, album and tags, ignoring case and accents', () => {
  assert.deepEqual(titles(filterTracks(all, { query: 'LAKE', sort: 'recent' }, label)), ['banana hour']);
  assert.deepEqual(titles(filterTracks(all, { query: 'pianó', sort: 'recent' }, label)), ['grape light']);
  assert.deepEqual(titles(filterTracks(all, { query: 'tape', sort: 'title' }, label)), ['banana hour', 'berry tape']);
});

test('sorts by recent, title and plays', () => {
  assert.deepEqual(titles(filterTracks(all, { query: '', sort: 'recent' }, label)), ['berry tape', 'grape light', 'plum, slowly', 'banana hour']);
  assert.deepEqual(titles(filterTracks(all, { query: '', sort: 'plays' }, label)), ['grape light', 'plum, slowly', 'banana hour', 'berry tape']);
});

test('filters by who can listen, album and tag', () => {
  assert.deepEqual(titles(filterTracks(all, { query: '', sort: 'recent', access: 'only you' }, label)), ['berry tape']);
  assert.deepEqual(titles(filterTracks(all, { query: '', sort: 'recent', access: 'link' }, label)), ['plum, slowly']);
  assert.deepEqual(titles(filterTracks(all, { query: '', sort: 'recent', album: 'snacks' }, label)), ['grape light']);
  assert.deepEqual(titles(filterTracks(all, { query: '', sort: 'recent', tag: 'ambient' }, label)), ['plum, slowly']);
  assert.equal(accessGroup('open to supporters'), 'limited');
});

test('facets only offer what is there', () => {
  const found = facets(all, label);
  assert.deepEqual(found.access.map(g => g.value), ['everyone', 'link', 'only you']);
  assert.deepEqual(found.albums.map(a => a.name), ['lake tapes', 'snacks']);
  assert.equal(found.tags.length, 3);
});

test('loadAll follows cursors to the end', async () => {
  const pages: Record<string, { data: number[]; has_more: boolean; next_cursor?: string }> = {
    start: { data: [1, 2], has_more: true, next_cursor: 'b' }, b: { data: [3], has_more: false }
  };
  assert.deepEqual(await loadAll(async cursor => ({ object: 'list', ...pages[cursor ?? 'start'] })), [1, 2, 3]);
});

test('match ranges point at the hit', () => {
  assert.deepEqual(matchRange('lake tapes', 'TAPE'), [5, 9]);
  assert.equal(matchRange('lake tapes', 'zzz'), undefined);
  assert.equal(matchRange('lake tapes', ' '), undefined);
});
