import test from 'node:test';
import assert from 'node:assert/strict';
import { appendContinuation, clearPicks, emptyQueue, enqueue, moveEntry, removeEntry, shufflePicks, switchContext, trimGenerated, type QueueState } from '../src/queue-state.ts';

let sequence = 0;
const entry = (id: string) => ({ key: String(++sequence), track: { id } });
const ids = (state: QueueState<{ id: string }>) => state.entries.map(item => item.track.id);

test('switching albums preserves explicit picks, replaces the old tail and retains repeated collection occurrences', () => {
  let state = switchContext(emptyQueue(), ['old', 'old-tail'].map(entry), 0, 'Old album');
  state = enqueue(state, entry('my-pick'));
  state = switchContext(state, ['new', 'repeat', 'repeat'].map(entry), 0, 'New album');
  assert.deepEqual(ids(state), ['new', 'my-pick', 'repeat', 'repeat']);
  assert.equal(new Set(state.entries.map(item => item.key)).size, 4);
  assert.deepEqual(state.tail, { from: 2, kind: 'collection', label: 'New album' });
  state = switchContext(state, [entry('single')], 0);
  assert.deepEqual(ids(state), ['single', 'my-pick']);
  assert.equal(state.tail, undefined);
});

test('hand-queued duplicates stay distinct and play before generated music', () => {
  let state = switchContext(emptyQueue(), [entry('current')], 0);
  state = appendContinuation(state, ['current', 'suggested', 'suggested'].map(entry));
  state = enqueue(enqueue(state, entry('pick')), entry('pick'));
  assert.deepEqual(ids(state), ['current', 'pick', 'pick', 'suggested']);
  assert.equal(state.tail?.from, 3);
  state = removeEntry(state, 1);
  assert.deepEqual(ids(state), ['current', 'pick', 'suggested']);
  assert.equal(state.tail?.from, 2);
  assert.equal(removeEntry(state, 0), state);
});

test('clear and shuffle affect conscious picks without vetoing continuation', () => {
  let state = switchContext(emptyQueue(), ['current', 'album-tail'].map(entry), 0, 'Album');
  state = enqueue(enqueue(state, entry('pick-a')), entry('pick-b'));
  state = shufflePicks(state, () => 0);
  assert.deepEqual(ids(state), ['current', 'pick-b', 'pick-a', 'album-tail']);
  assert.deepEqual(ids(clearPicks(state)), ['current', 'album-tail']);
  assert.equal(trimGenerated(state), state);
  assert.equal(appendContinuation(state, [entry('suggested')]), state);
  state = { ...state, index: state.entries.length - 1 };
  state = appendContinuation(state, [entry('suggested')]);
  assert.deepEqual(ids(trimGenerated(state)), ['current', 'pick-b', 'pick-a', 'album-tail']);
});

test('dragging promotes a tail entry to a pick without burying existing picks', () => {
  let state = switchContext(emptyQueue(), ['current', 'tail-a', 'tail-b'].map(entry), 0, 'Album');
  state = enqueue(state, entry('pick'));
  state = moveEntry(state, 3, 1);
  assert.deepEqual(ids(state), ['current', 'tail-b', 'pick', 'tail-a']);
  assert.equal(state.tail?.from, 3);
  assert.deepEqual(ids(moveEntry(state, 1, 3)), ['current', 'pick', 'tail-b', 'tail-a']);
  assert.equal(moveEntry(state, 1, 3).tail?.from, 3);
  assert.equal(moveEntry(state, 0, 2), state);
});

test('repeating the selected authored track later in a collection preserves both occurrences', () => {
  const state = switchContext(emptyQueue(), [{ key: 'first', track: { id: 'same' } }, { key: 'second', track: { id: 'same' } }], 0, 'Album');
  assert.deepEqual(state.entries.map(entry => entry.key), ['first', 'second']);
});

test('continuation compacts played history without discarding current or upcoming occurrences', () => {
  const state = { entries: Array.from({ length: 200 }, (_, at) => entry(String(at))), index: 198 };
  const next = enqueue(state, entry('new'));
  assert.equal(next.entries.length, 200);
  assert.equal(next.entries[next.index].key, state.entries[state.index].key);
  assert.equal(next.entries.at(-1)?.track.id, 'new');
});

test('dragging to the tail boundary promotes a pick even with no explicit future queue', () => {
  const initial = switchContext(emptyQueue(), ['current', 'tail-a', 'tail-b'].map(entry), 0, 'Album');
  const moved = moveEntry(initial, 2, 1);
  assert.deepEqual(ids(moved), ['current', 'tail-b', 'tail-a']);
  assert.equal(moved.tail?.from, 2);
  assert.deepEqual(ids(clearPicks(moved)), ['current', 'tail-a']);
});
