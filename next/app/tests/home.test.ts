import assert from 'node:assert/strict';
import test from 'node:test';
import { readFollows, resolveFollowArtists } from '../src/home-network.ts';
import { nextPopulatedChart, parseSelectedTags, selectedTagsKey } from '../src/home-state.ts';

test('follows traverse all pages and keep oldest follows first', async () => {
  const requests: URL[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url);
    return Response.json(url.searchParams.has('cursor') ? { follows: [{ did: 'did:plc:older', avatar: 'old.png' }] } : { follows: [{ did: 'did:plc:newer' }], cursor: 'page2' });
  };
  const follows = await readFollows('did:plc:me', new AbortController().signal, request);
  assert.deepEqual(follows.map(({ did }) => did), ['did:plc:older', 'did:plc:newer']);
  assert.equal(requests[1].searchParams.get('cursor'), 'page2');
});

test('pagination failure never returns a partial graph', async () => {
  let count = 0;
  const request: typeof fetch = async () => ++count === 1 ? Response.json({ follows: [{ did: 'did:plc:first' }], cursor: 'next' }) : new Response('', { status: 503 });
  await assert.rejects(readFollows('did:plc:me', new AbortController().signal, request), /could not load/);
});

test('repeated cursor is rejected rather than looping', async () => {
  const request: typeof fetch = async () => Response.json({ follows: [], cursor: 'same' });
  await assert.rejects(readFollows('did:plc:me', new AbortController().signal, request), /did not advance/);
});

test('artist batches are bounded, resolve concurrently and retain follow order', async () => {
  const follows = Array.from({ length: 1100 }, (_, index) => ({ did: `did:plc:${index}`, avatar: index === 0 ? 'follow-avatar' : null }));
  let concurrent = 0; let peak = 0;
  const result = await resolveFollowArtists(follows, async (dids) => {
    assert.ok(dids.length <= 500); concurrent += 1; peak = Math.max(peak, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 1)); concurrent -= 1;
    return dids.reverse().map((did) => ({ did, avatar_url: 'indexed-avatar' }));
  }, new AbortController().signal);
  assert.equal(peak, 2);
  assert.deepEqual(result.map(({ did }) => did), follows.map(({ did }) => did));
  assert.equal(result[0].avatar_url, 'follow-avatar');
});

test('chart period cycling skips empty periods', async () => {
  const visited: string[] = [];
  const result = await nextPopulatedChart('month', async (period) => {
    visited.push(period); return period === 'all_time' ? ['track'] : [];
  });
  assert.deepEqual(visited, ['week', 'day', 'all_time']); assert.equal(result.period, 'all_time');
});

test('tag persistence is account isolated and rejects corrupt or oversized values', () => {
  assert.notEqual(selectedTagsKey('did:plc:a'), selectedTagsKey('did:plc:b'));
  assert.notEqual(selectedTagsKey(null), selectedTagsKey('did:plc:a'));
  assert.deepEqual(parseSelectedTags('{'), []);
  assert.deepEqual(parseSelectedTags('["ambient",null,"ambient",42,""]'), ['ambient']);
  assert.equal(parseSelectedTags(JSON.stringify(Array.from({ length: 30 }, (_, i) => `tag${i}`))).length, 10);
});

test('cancelled account traversal cannot start artist batches', async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  await assert.rejects(resolveFollowArtists([{ did: 'did:plc:old-account', avatar: null }], async () => {
    called = true; return [];
  }, controller.signal), /Cancelled/);
  assert.equal(called, false);
});

test('long DID batches stay below the artist API body limit', async () => {
  const follows = Array.from({ length: 100 }, (_, index) => ({ did: `did:web:${'a'.repeat(1800)}${index}`, avatar: null }));
  let batches = 0;
  await resolveFollowArtists(follows, async (dids) => {
    batches += 1;
    assert.ok(new TextEncoder().encode(JSON.stringify({ dids })).length < 65_536);
    return [];
  }, new AbortController().signal);
  assert.ok(batches > 1);
});

test('catalog tags expanded by Unicode lowercase survive selection persistence', () => {
  const authored = 'Ⱥ'.repeat(25);
  const catalog = 'ⱥ'.repeat(25);
  assert.equal(new TextEncoder().encode(authored).length, 50);
  assert.equal(new TextEncoder().encode(catalog).length, 75);
  assert.deepEqual(parseSelectedTags(JSON.stringify([catalog])), [catalog]);
  assert.deepEqual(parseSelectedTags(JSON.stringify(['x'.repeat(200), 'x'.repeat(201)])), ['x'.repeat(200)]);
});

test('track ages read as short columns and fall back to dates', async () => {
  const { timeAgo } = await import('../src/home-state.ts');
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(timeAgo('2026-11-14T11:59:30Z', now), 'now');
  assert.equal(timeAgo('2026-11-14T11:15:00Z', now), '45m');
  assert.equal(timeAgo('2026-11-14T02:00:00Z', now), '10h');
  assert.equal(timeAgo('2026-11-11T12:00:00Z', now), '3d');
  assert.match(timeAgo('2026-10-01T12:00:00Z', now), /^oct \d+$/);
  assert.match(timeAgo('2025-10-01T12:00:00Z', now), /, 2025$/);
  assert.equal(timeAgo('not a date', now), '');
  assert.equal(timeAgo('2026-11-14T12:05:00Z', now), 'now', 'clock skew never shows a negative age');
});

test('chronological groups follow calendar days, then months and years', async () => {
  const { dayGroup } = await import('../src/home-state.ts');
  const now = new Date(2026, 10, 14, 12).getTime();
  assert.equal(dayGroup(new Date(2026, 10, 14, 0, 5).toISOString(), now), 'today');
  assert.equal(dayGroup(new Date(2026, 10, 13, 23, 55).toISOString(), now), 'yesterday');
  assert.equal(dayGroup(new Date(2026, 10, 10).toISOString(), now), 'this week');
  assert.equal(dayGroup(new Date(2026, 10, 3).toISOString(), now), 'last week');
  assert.equal(dayGroup(new Date(2026, 9, 20).toISOString(), now), 'october');
  assert.equal(dayGroup(new Date(2025, 9, 20).toISOString(), now), '2025');
});

test('durations format for list columns', async () => {
  const { formatDuration } = await import('../src/home-state.ts');
  assert.equal(formatDuration(181), '3:01');
  assert.equal(formatDuration(4520), '1:15:20');
  assert.equal(formatDuration(null), '');
  assert.equal(formatDuration(0), '');
});

test('artist of the week ranks liked artists and changes on mondays', async () => {
  const { rankedArtists, weekNumber } = await import('../src/home-state.ts');
  const t = (did: string, likes: number) => ({ artist: { did }, metrics: { like_count: likes } });
  assert.deepEqual(rankedArtists([t('did:b', 1), t('did:a', 3), t('did:b', 1), t('did:c', 0)]), ['did:a', 'did:b', 'did:c']);
  assert.deepEqual(rankedArtists([]), []);
  const monday = Date.parse('2026-11-09T00:00:00Z');
  assert.equal(weekNumber(monday), weekNumber(monday + 6.9 * 86_400_000), 'the pick holds all week');
  assert.equal(weekNumber(monday) + 1, weekNumber(monday + 7 * 86_400_000));
  assert.equal(weekNumber(monday - 1) + 1, weekNumber(monday), 'weeks turn over at monday 00:00 utc');
});

test('artist of the week shows each title once', async () => {
  const { distinctTracks } = await import('../src/home-state.ts');
  const t = (id: string, title: string) => ({ id, metadata: { title } });
  assert.deepEqual(distinctTracks([t('1', 'First Circle'), t('2', 'first  circle '), t('3', 'April')]).map(track => track.id), ['1', '3']);
});

test('desktop rows shorten big counts without rounding up', async () => {
  const { compactCount } = await import('../src/home-state.ts');
  assert.deepEqual([0, 999, 1000, 1299, 12_900, 132_150, 999_999, 3_450_000].map(compactCount), ['0', '999', '1k', '1.2k', '12.9k', '132.1k', '999.9k', '3.4m']);
  for (const count of [7, 1_000_000_000 - 1, 999_999_999_999]) assert.ok(compactCount(count).length <= 6, `${count} fits the column`);
});
