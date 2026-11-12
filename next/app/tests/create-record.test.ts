import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@atcute/client';
import { recordCreator, CreateUnconfirmed } from '../src/publishing/create-record.ts';
import { createKey, createOperation, scopedCreate, sameRecord, type CreateOperation, type CreateStorage } from '../src/publishing/create-operation.ts';

const operation: CreateOperation = { owner: 'did:plc:fixture', collection: 'fm.plyr.list', rkey: '3jzfcijpj2z2a', uri: 'at://did:plc:fixture/fm.plyr.list/3jzfcijpj2z2a', record: { $type: 'fm.plyr.list', name: 'night', items: [], createdAt: '2026-11-12T00:00:00Z' } };
function fixture() {
  const durable = new Map<string, CreateOperation>(), records = new Map<string, Record<string, unknown>>();
  const posts: { rkey: string; record: Record<string, unknown> }[] = [];
  const flags = { lost: false, commit: true, offline: false, failStorage: false, current: true };
  const storage: CreateStorage = {
    async load(owner, collection) { return [...durable.values()].filter(item => item.owner === owner && item.collection === collection); },
    async put(item) { if (flags.failStorage) throw new Error('disk unavailable'); durable.set(createKey(item), structuredClone(item)); },
    async accept(item, cid) { const existing = durable.get(createKey(item)); if (existing) durable.set(createKey(item), { ...existing, cid }); },
    async archive(item, archived) { const existing = durable.get(createKey(item)); if (!existing) throw new Error('missing'); durable.set(createKey(item), { ...existing, archived }); },
    async delete(item) { durable.delete(createKey(item)); },
  };
  const rpc = new Client({ handler: async (url, init) => {
    const parsed = new URL(url, 'https://pds.invalid');
    let status = 200, body: unknown;
    if (url.includes('getRecord')) {
      if (flags.offline) throw new TypeError('offline');
      const key = parsed.searchParams.get('rkey');
      if (key && records.has(key)) body = { uri: operation.uri, cid: 'cid1', value: records.get(key) };
      else { status = 404; body = { error: 'RecordNotFound' }; }
    } else {
      assert.ok(url.includes('createRecord'));
      const input = JSON.parse(String(init?.body));
      posts.push(input);
      if (records.has(input.rkey)) { status = 500; body = { error: 'DuplicateKey' }; }
      else {
        if (flags.commit) records.set(input.rkey, input.record);
        if (flags.lost) throw new TypeError('response lost');
        body = { uri: operation.uri, cid: 'cid1' };
      }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  } });
  const creator = () => recordCreator(rpc, storage, () => { if (!flags.current) throw new Error('account changed'); });
  return { creator, storage, records, posts, flags, durable };
}

test('lost accepted response survives reload and reconciles without another create', async () => {
  const f = fixture();
  f.flags.lost = true; f.flags.offline = true;
  await assert.rejects(f.creator().create(operation), CreateUnconfirmed);
  assert.equal(f.records.size, 1); assert.equal(f.durable.size, 1);
  f.flags.offline = false;
  const restored = createOperation(JSON.parse(JSON.stringify([...f.durable.values()][0])));
  assert.equal((await f.creator().check(restored)).state, 'accepted');
  assert.equal((await f.creator().retry(restored)).state, 'accepted');
  assert.equal(f.posts.length, 1);
  assert.equal([...f.durable.values()][0].cid, 'cid1');
});

test('missing record retries exactly the original key and immutable payload', async () => {
  const f = fixture();
  f.flags.lost = true; f.flags.commit = false;
  await assert.rejects(f.creator().create(operation), CreateUnconfirmed);
  f.flags.lost = false; f.flags.commit = true;
  assert.equal((await f.creator().retry(operation)).state, 'accepted');
  assert.equal(f.records.size, 1);
  assert.deepEqual(f.posts.map(item => item.rkey), [operation.rkey, operation.rkey]);
  assert.deepEqual(f.posts[0].record, f.posts[1].record);
});

test('concurrent same-operation recovery has one record and never overwrites', async () => {
  const f = fixture();
  await f.storage.put(operation);
  const results = await Promise.all([f.creator().retry(operation), f.creator().retry(operation)]);
  assert.ok(results.every(result => result.state === 'accepted'));
  assert.equal(f.records.size, 1);
  assert.ok(f.posts.every(input => input.rkey === operation.rkey));
  const changed = { ...operation.record, newField: 'preserve me' };
  f.records.set(operation.rkey, changed);
  const before = f.posts.length;
  assert.equal((await f.creator().retry(operation)).state, 'different');
  assert.equal(f.posts.length, before);
  assert.deepEqual(f.records.get(operation.rkey), changed);
});

test('storage and session failures fail closed before any create', async () => {
  const f = fixture();
  f.flags.failStorage = true;
  await assert.rejects(f.creator().create(operation), /disk unavailable/);
  assert.equal(f.posts.length, 0);
  f.flags.failStorage = false; f.flags.current = false;
  await assert.rejects(f.creator().retry(operation), /account changed/);
  assert.equal(f.posts.length, 0);
});

test('record matching is recursive and independent of object order', () => {
  assert.ok(sameRecord({ x: { a: 1, b: 2 }, y: [] }, { y: [], x: { b: 2, a: 1 } }));
  assert.ok(!sameRecord({ x: [1, 2] }, { x: [2, 1] }));
  assert.throws(() => createOperation({ ...operation, uri: 'at://someone/else/wrong' }));
  assert.throws(() => scopedCreate(operation, 'did:plc:other', operation.collection, createKey(operation)));
  assert.throws(() => scopedCreate(operation, operation.owner, 'fm.plyr.track', createKey(operation)));
});

test('later rejection and absent read cannot erase an earlier in-flight create', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void, committed = false, posts = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const rpc = new Client({ handler: async (url, init) => {
    if (url.includes('getRecord')) return new Response(JSON.stringify(committed
      ? { uri: operation.uri, cid: 'late', value: operation.record } : { error: 'RecordNotFound' }),
      { status: committed ? 200 : 404, headers: { 'content-type': 'application/json' } });
    assert.equal(JSON.parse(String(init?.body)).rkey, operation.rkey);
    if (++posts === 1) {
      await new Promise<void>(resolve => { release = resolve; entered(); });
      committed = true;
      return new Response(JSON.stringify({ uri: operation.uri, cid: 'late' }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
  } });
  const creator = recordCreator(rpc, f.storage, () => {});
  const first = creator.create(operation);
  await started;
  await assert.rejects(creator.retry(operation), CreateUnconfirmed);
  assert.equal(f.durable.size, 1, 'later rejection must retain earlier intent');
  await f.storage.archive(operation, true);
  release();
  assert.equal((await first).state, 'accepted');
  assert.equal([...f.durable.values()][0].cid, 'late');
  assert.equal([...f.durable.values()][0].archived, true, 'late completion cannot reactivate an archived attempt');
});

test('explicit archive survives late acceptance and preserves the original immutable intent', async () => {
  const f = fixture();
  f.flags.commit = false; f.flags.lost = true;
  await assert.rejects(f.creator().create(operation), CreateUnconfirmed);
  await f.storage.archive(operation, true);
  const restored = createOperation(JSON.parse(JSON.stringify([...f.durable.values()][0])));
  assert.equal(restored.archived, true);
  assert.deepEqual(restored.record, operation.record);
  f.records.set(operation.rkey, operation.record);
  assert.equal((await f.creator().check(restored)).state, 'accepted');
  assert.equal([...f.durable.values()][0].archived, true);
  assert.equal(f.posts.length, 1);
  await f.storage.archive(operation, false);
  assert.equal([...f.durable.values()][0].cid, 'cid1');
  assert.equal([...f.durable.values()][0].archived, false);
  assert.throws(() => createOperation({ ...operation, archived: 'yes' }));
});

test('a recovered public collection cannot publish a private Space reference', async () => {
  const f = fixture();
  const unsafe = { ...operation, record: { ...operation.record, items: [{ subject: {
    uri: 'at://did:plc:fixture/space/fm.plyr.privateMedia/self/did:plc:fixture/fm.plyr.track/private', cid: 'privatecid',
  } }] } };
  await f.storage.put(unsafe);
  await assert.rejects(f.creator().retry(unsafe), /private tracks cannot/);
  assert.equal(f.posts.length, 0);
  assert.equal(f.durable.size, 1);
});
