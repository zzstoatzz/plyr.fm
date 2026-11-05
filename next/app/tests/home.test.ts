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
