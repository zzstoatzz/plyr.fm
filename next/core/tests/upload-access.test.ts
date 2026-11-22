import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Auth } from '../src/auth-state.ts';
import type { createPublicPds, NewTrack } from '../src/pds.ts';
import type { RepoRpc } from '../src/publishing/repo-rpc.ts';
import type { Rule } from '../src/access/policy.ts';
import { readRule, sameRule } from '../src/access/policy.ts';
import { accessProblem, accessRules, accessSummary, addWay, buyLinkFor, downloadsFor, onlyYou, previewRules, readAccessDraft, sellFromLink, sellProblem, downloadChoices } from '../src/publishing/upload-access.ts';
import { uploadRoute, needsPlyrStorage } from '../src/publishing/upload-queue-model.ts';
import { queuedUploadDraft, queuedUploadKey, readQueuedUploadDraft, type QueuedUploadDraft } from '../src/publishing/queued-upload-draft.ts';
import { createUploadQueue } from '../src/publishing/upload-queue.ts';
import { addBuyLink } from '../src/selling.ts';

const owner = 'did:plc:fixture';
const resolve = async (handle: string) => `did:plc:${handle.split('.')[0]}`;

test('open uploads write no rules; only you is closed with none', async () => {
  assert.deepEqual(await accessRules({ closed: false, ways: [{ kind: 'supporter' }] }, resolve), []);
  assert.equal(onlyYou({ closed: true, ways: [] }), true);
  assert.equal(onlyYou({ closed: true, ways: [{ kind: 'supporter' }] }), false);
  assert.deepEqual(accessSummary({ closed: false, ways: [] }), { label: 'open to everyone' });
  assert.deepEqual(accessSummary({ closed: true, ways: [] }), { label: 'only you' });
});

test('ways become rules: prices in cents, handles as dids, people deduplicated', async () => {
  const rules = await accessRules({ closed: true, ways: [
    { kind: 'supporter' }, { kind: 'purchase', price: '4.99' }, { kind: 'members', people: '@ann.bsky.social, bo.example ann.bsky.social' },
  ] }, resolve);
  assert.deepEqual(rules, [
    { kind: 'supporter' }, { kind: 'purchase', amount: 499, currency: 'USD' }, { kind: 'members', members: ['did:plc:ann', 'did:plc:bo'] },
  ]);
  assert.equal(accessSummary({ closed: true, ways: [{ kind: 'supporter' }, { kind: 'purchase', price: '5' }] }).detail, 'supporters · $5 to buy');
});

test('a bad price or empty list is caught at the field, before anything uploads', async () => {
  assert.equal(accessProblem({ closed: true, ways: [{ kind: 'purchase', price: 'five' }] }), 'enter a price, like 5 or 4.99.');
  assert.match(accessProblem({ closed: true, ways: [{ kind: 'members', people: ' ' }] }) ?? '', /at least one handle/);
  await assert.rejects(accessRules({ closed: true, ways: [{ kind: 'purchase', price: '' }] }, resolve));
  assert.equal(accessProblem({ closed: false, ways: [{ kind: 'purchase', price: '' }] }), undefined);
  assert.deepEqual(previewRules({ closed: true, ways: [{ kind: 'purchase', price: '' }, { kind: 'signedIn' }] }), [{ rule: { kind: 'signedIn' } }]);
});

test('ways keep one of each kind in a stable order', () => {
  const ways = addWay(addWay(addWay([], 'members'), 'supporter'), 'supporter');
  assert.deepEqual(ways.map(way => way.kind), ['supporter', 'members']);
});

test('a saved draft never comes back with ways the artist did not pick', () => {
  assert.deepEqual(readAccessDraft({ closed: true, ways: [{ kind: 'supporter' }, { kind: 'bogus' }, { kind: 'purchase', price: 3 }] }), { closed: true, ways: [{ kind: 'supporter' }] });
  assert.deepEqual(readAccessDraft({ closed: false, ways: [{ kind: 'supporter' }] }), { closed: false, ways: [] });
  // a saved access that can't be read comes back as only you, never open
  assert.deepEqual(readAccessDraft('nope'), { closed: true, ways: [] });
});

test('rules read back strictly and compare by meaning', () => {
  assert.deepEqual(readRule({ kind: 'purchase', amount: 500, currency: 'USD' }), { kind: 'purchase', amount: 500, currency: 'USD' });
  assert.equal(readRule({ kind: 'purchase', amount: 0, currency: 'USD' }), undefined);
  assert.equal(readRule({ kind: 'wizard' }), undefined);
  assert.equal(sameRule({ kind: 'members', members: ['did:plc:b', 'did:plc:a'] }, { kind: 'members', members: ['did:plc:a', 'did:plc:b'] }), true);
  assert.equal(sameRule({ kind: 'purchase', amount: 500, currency: 'USD' }, { kind: 'purchase', amount: 600, currency: 'USD' }), false);
});

test('closed audio goes to the PDS as is, never through plyr storage', () => {
  const wav = { name: 'demo.wav', type: 'audio/wav', size: 50_000_000 };
  assert.equal(uploadRoute(wav).kind, 'service');
  assert.deepEqual(uploadRoute(wav, undefined, true), { kind: 'pds' });
  assert.equal(needsPlyrStorage(wav, true), false);
  assert.throws(() => uploadRoute({ ...wav, size: 200_000_000 }, undefined, true), /100 MB/);
});

test('a queued closed upload keeps its ways in; an unreadable rule fails the draft rather than publishing open', () => {
  const file = { name: 'demo.mp3', type: 'audio/mpeg', size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
  const waysIn: Rule[] = [{ kind: 'supporter' }, { kind: 'purchase', amount: 500, currency: 'USD' }];
  const draft = queuedUploadDraft({ file, title: 't', artist: 'a', waysIn, explicit: true, features: [{ did: 'did:plc:ann', handle: 'ann.bsky.social' }] }, owner, 'id1');
  const stored = JSON.parse(JSON.stringify(draft));
  const read = readQueuedUploadDraft(stored, owner, queuedUploadKey({ owner, id: 'id1' }));
  assert.deepEqual(read.waysIn, waysIn);
  assert.equal(read.explicit, true);
  assert.deepEqual(read.features, [{ did: 'did:plc:ann', handle: 'ann.bsky.social' }]);
  assert.throws(() => readQueuedUploadDraft({ ...stored, waysIn: [{ kind: 'wizard' }] }, owner, queuedUploadKey({ owner, id: 'id1' })));
});

function fixtureQueue(options: { saveBuyLink?: boolean; uploadStorage?: boolean; failUpload?: boolean } = {}) {
  const calls: string[] = [];
  const drafts = new Map<string, QueuedUploadDraft>();
  const reservation = { owner, collection: 'fm.plyr.track', rkey: '3222222222222', uri: `at://${owner}/fm.plyr.track/3222222222222`, record: {} };
  const pds = {
    reserveCreate: async () => reservation,
    uploadTrack: async (input: NewTrack) => { calls.push(`upload:${input.waysIn?.length ?? 0}`); if (options.failUpload) throw new Error('pds said no'); return { uri: reservation.uri, status: 'indexed' }; },
    pendingCreates: async () => [],
    dismissCreate: async () => {},
  } as unknown as ReturnType<typeof createPublicPds>;
  let done!: () => void;
  const finished = new Promise<void>(resolve => { done = resolve; });
  const queue = createUploadQueue({
    getAuth: () => ({ did: owner, rpc: {}, uploadStorage: !!options.uploadStorage }) as Auth<RepoRpc>,
    createPds: () => pds,
    measureAudioDuration: async () => 1,
    openUploadReader: () => { throw new Error('not used'); },
    sendParts: async () => { throw new Error('not used'); },
    uploadStorage: { load: async () => [], put: async () => {}, delete: async () => {} },
    queuedDrafts: {
      load: async () => [...drafts.values()], put: async draft => { drafts.set(draft.id, draft); },
      has: async draft => drafts.has(draft.id), take: async draft => drafts.delete(draft.id), withLock: async (_draft, task) => task(),
    },
    createUploadTransport: () => { throw new Error('not used'); },
    applyGenreTags: async () => {},
    ...(options.saveBuyLink ? { saveBuyLink: async (_session, subject, link) => { calls.push(link ? `buy:${subject}:${link.url}:${link.amount ?? ''}` : `unbuy:${subject}`); } } : {}),
    randomUUID: () => 'id1',
    sha256: async () => new ArrayBuffer(32),
    onJob: job => { if (job.phase === 'done' || job.phase === 'failed') done(); },
  });
  return { queue, calls, finished, reservation };
}

const wavFile = { name: 'demo.wav', type: 'audio/wav', size: 50_000_000, arrayBuffer: async () => new ArrayBuffer(0) };

test('the queue sends a closed track straight to the PDS with its ways in', async () => {
  const { queue, calls, finished } = fixtureQueue();
  await queue.add({ file: wavFile, title: 'demo', artist: 'nate', waysIn: [{ kind: 'supporter' }] });
  await finished;
  // uploadTrack writes the ways before the record
  assert.deepEqual(calls, ['upload:1']);
  assert.equal(queue.snapshot()[0]?.phase, 'done');
});

test('a buy link is saved for the reserved track before it uploads', async () => {
  const { queue, calls, finished, reservation } = fixtureQueue({ saveBuyLink: true });
  await queue.add({ file: wavFile, title: 'demo', artist: 'nate', waysIn: [{ kind: 'supporter' }], buyLink: { url: 'https://me.bandcamp.com/track/demo', amount: 800, currency: 'USD' } });
  await finished;
  assert.deepEqual(calls, [`buy:${reservation.uri}:https://me.bandcamp.com/track/demo:800`, 'upload:1']);
});

test('a buy link without a way to save it fails before anything uploads', async () => {
  const { queue, calls, finished } = fixtureQueue();
  await queue.add({ file: wavFile, title: 'demo', artist: 'nate', waysIn: [{ kind: 'supporter' }], buyLink: { url: 'https://me.bandcamp.com/track/demo' } });
  await finished;
  assert.deepEqual(calls, []);
  assert.equal(queue.snapshot()[0]?.phase, 'failed');
});

test('plyr.fm storage keeps downloads on, so a narrower setting fails instead of being dropped', async () => {
  const { queue, calls, finished } = fixtureQueue({ uploadStorage: true });
  await queue.add({ file: wavFile, title: 'demo', artist: 'nate', downloadPolicy: 'off' });
  await finished;
  assert.deepEqual(calls, []);
  assert.match(queue.snapshot()[0]?.error ?? '', /downloads stay on/);
});

test('download, feed and buy-link choices survive a queued draft; unreadable ones fail it', () => {
  const file = { name: 'demo.mp3', type: 'audio/mpeg', size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
  const draft = queuedUploadDraft({ file, title: 't', artist: 'a', downloadPolicy: 'ask', unlisted: true, buyLink: { url: 'https://me.bandcamp.com/x', amount: 500, currency: 'USD' } }, owner, 'id1');
  const stored = JSON.parse(JSON.stringify(draft));
  const key = queuedUploadKey({ owner, id: 'id1' });
  const read = readQueuedUploadDraft(stored, owner, key);
  assert.equal(read.downloadPolicy, 'ask');
  assert.equal(read.unlisted, true);
  assert.deepEqual(read.buyLink, { url: 'https://me.bandcamp.com/x', amount: 500, currency: 'USD' });
  assert.throws(() => readQueuedUploadDraft({ ...stored, downloadPolicy: 'everyone' }, owner, key));
  assert.throws(() => readQueuedUploadDraft({ ...stored, unlisted: 'yes' }, owner, key));
  assert.throws(() => readQueuedUploadDraft({ ...stored, buyLink: { url: 'javascript:alert(1)' } }, owner, key));
});

test('the form keeps downloads on for plyr.fm storage and closes them by default on a closed track', () => {
  assert.equal(downloadsFor({ closed: false, ways: [] }, undefined), 'open');
  assert.equal(downloadsFor({ closed: true, ways: [{ kind: 'supporter' }] }, undefined), 'off');
  // a closed track's file stays in its space: only supporter downloads reach it
  assert.equal(downloadsFor({ closed: true, ways: [{ kind: 'supporter' }] }, 'ask'), 'off');
  assert.equal(downloadsFor({ closed: true, ways: [{ kind: 'supporter' }] }, 'supporters'), 'supporters');
  assert.deepEqual(downloadChoices({ closed: true, ways: [] }).map(choice => choice.value), ['supporters', 'off']);
  assert.equal(downloadsFor({ closed: false, ways: [] }, 'off', true), 'open');
  assert.equal(sellProblem({ url: 'nope' })?.includes('full link'), true);
  assert.equal(sellProblem({ url: 'me.bandcamp.com/x' }), undefined);
  assert.deepEqual(buyLinkFor({ url: 'me.bandcamp.com/x' }), { url: 'https://me.bandcamp.com/x' });
  assert.deepEqual(sellFromLink({ url: 'https://me.bandcamp.com/x', amount: 800, currency: 'USD' }), { url: 'https://me.bandcamp.com/x' });
});

test('a buy link saved for an upload that fails before publishing is taken back', async () => {
  const { queue, calls, finished, reservation } = fixtureQueue({ saveBuyLink: true, failUpload: true });
  await queue.add({ file: wavFile, title: 'demo', artist: 'nate', waysIn: [{ kind: 'supporter' }], buyLink: { url: 'https://me.bandcamp.com/track/demo' } });
  await finished;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [`buy:${reservation.uri}:https://me.bandcamp.com/track/demo:`, 'upload:1', `unbuy:${reservation.uri}`]);
});

test('a full buy-link list refuses a new link instead of dropping it', async () => {
  const links = Array.from({ length: 200 }, (_, at) => ({ subject: `at://${owner}/fm.plyr.track/${at}`, url: 'https://me.bandcamp.com/x' }));
  const writes: unknown[] = [];
  const settings = async (patch?: Record<string, unknown>) => { if (patch) writes.push(patch); return { buyLinks: links }; };
  await assert.rejects(addBuyLink(settings, `at://${owner}/fm.plyr.track/new`, { url: 'https://me.bandcamp.com/y' }), /200 buy links/);
  await addBuyLink(settings, links[0].subject, { url: 'https://me.bandcamp.com/z' });
  assert.equal(writes.length, 1);
});
