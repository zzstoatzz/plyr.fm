import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JamClock, JamConnection, isJamState, jamPosition, type JamSocket, type JamState } from '../src/jam-connection.ts';

const base: JamState = { epoch: 'room_epoch', revision: 1, queue: [{ id: 'track', uri: 'at://did:plc:artist/fm.plyr.track/one', cid: 'cid', durationMs: 60_000 }],
  index: 0, occurrence: 1, playing: true, positionMs: 1_000, updatedAtMs: 10_000 };

class Socket implements JamSocket {
  readyState = 0;
  onopen: JamSocket['onopen'] = null;
  onmessage: JamSocket['onmessage'] = null;
  onclose: JamSocket['onclose'] = null;
  onerror: JamSocket['onerror'] = null;
  sent: Record<string, unknown>[] = [];
  send(text: string) { this.sent.push(JSON.parse(text) as Record<string, unknown>); }
  close() { this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, new Event('close') as CloseEvent); }
  open() { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, new Event('open')); }
  receive(value: object) { this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data: JSON.stringify(value) })); }
}

function setup() {
  const socket = new Socket();
  const updates: { state: JamState; force: boolean }[] = [];
  const errors: string[] = [];
  const connection = new JamConnection({ admit: async () => ({ ticket: 'fixture', websocketUrl: 'wss://fixture.test/socket' }), socket: () => socket,
    now: () => 10_000, onState: (state, force) => updates.push({ state, force }), onPhase: () => {}, onError: error => errors.push(error) });
  return { socket, updates, errors, connection };
}

test('room timeline freezes while paused and clamps the playing position to duration', () => {
  assert.equal(jamPosition(base, 12_000), 3_000);
  assert.equal(jamPosition(base, 100_000), 60_000);
  assert.equal(jamPosition({ ...base, playing: false }, 100_000), 1_000);
  assert.equal(isJamState({ ...base, occurrence: 'bad' }), false);
});

test('clock uses midpoint offset from the least-delayed recent sample', () => {
  let now = 1_100;
  const clock = new JamClock(() => now);
  clock.observe(5_050, 1_000);
  assert.equal(clock.serverNow(), 5_100);
  now = 2_020;
  clock.observe(6_010, 2_000);
  assert.equal(clock.serverNow(), 6_020);
  now = 3_500;
  clock.observe(7_500, 3_000);
  assert.equal(clock.serverNow(), 7_500);
});

test('rapid seeks retain only the latest pending position and advance after own acknowledgement', async () => {
  const { connection, socket, updates } = setup();
  try {
    await connection.connect(); socket.open(); socket.receive({ type: 'state', state: base, serverTimeMs: 10_000 });
    connection.command({ action: 'seek', positionMs: 5_000 });
    connection.command({ action: 'seek', positionMs: 10_000 });
    connection.command({ action: 'seek', positionMs: 20_000 });
    const commands = () => socket.sent.filter(frame => frame.action);
    assert.equal(commands().length, 1);
    const first = commands()[0];
    socket.receive({ type: 'result', id: first.id, outcome: 'applied', state: { ...base, revision: 2, positionMs: 5_000 }, serverTimeMs: 10_000 });
    assert.equal(commands().length, 2);
    assert.equal(commands()[1].positionMs, 20_000);
    assert.equal(commands()[1].expectedRevision, 2);
    assert.equal(updates.at(-1)?.force, true);
  } finally { connection.close(); }
});

test('explicit pause remains pause and stale room frames cannot move playback backward', async () => {
  const { connection, socket, updates } = setup();
  try {
    await connection.connect(); socket.open(); socket.receive({ type: 'state', state: base, serverTimeMs: 10_000 });
    connection.command({ action: 'pause' });
    assert.equal(socket.sent.at(-1)?.action, 'pause');
    const sent = socket.sent.at(-1)!;
    socket.receive({ type: 'result', id: sent.id, outcome: 'applied', state: { ...base, revision: 2, playing: false }, serverTimeMs: 10_000 });
    const count = updates.length;
    socket.receive({ type: 'state', state: base, serverTimeMs: 10_000 });
    assert.equal(updates.length, count);
    assert.equal(connection.state?.playing, false);
  } finally { connection.close(); }
});

test('reconnect refreshes admission, discards unsent commands and accepts the new authoritative epoch', async () => {
  const sockets: Socket[] = [];
  let admissions = 0;
  const connection = new JamConnection({ admit: async () => ({ ticket: String(++admissions), websocketUrl: 'wss://fixture.test/socket' }),
    socket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, onState: () => {}, onPhase: () => {}, onError: () => {} });
  try {
    await connection.connect(); sockets[0].open(); sockets[0].receive({ type: 'state', state: base, serverTimeMs: Date.now() });
    connection.command({ action: 'seek', positionMs: 5_000 });connection.command({ action: 'seek', positionMs: 25_000 });
    sockets[0].close();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(admissions, 2);
    sockets[1].open(); sockets[1].receive({ type: 'state', state: { ...base, epoch: 'new_epoch', revision: 0 }, serverTimeMs: Date.now() });
    assert.equal(connection.state?.epoch, 'new_epoch');
    assert.equal(sockets[1].sent.some(frame => frame.action), false);
  } finally { connection.close(); }
});


test('late command acknowledgement still settles after a newer broadcast without rebasing over it', async () => {
  const { connection, socket, errors } = setup();
  try {
    await connection.connect(); socket.open(); socket.receive({ type: 'state', state: base, serverTimeMs: 10_000 });
    connection.command({ action: 'seek', positionMs: 5_000 });
    connection.command({ action: 'seek', positionMs: 20_000 });
    const first = socket.sent.find(frame => frame.action)!;
    socket.receive({ type: 'state', state: { ...base, revision: 3, positionMs: 8_000 }, serverTimeMs: 10_000 });
    socket.receive({ type: 'result', id: first.id, outcome: 'applied', state: { ...base, revision: 2, positionMs: 5_000 }, serverTimeMs: 10_000 });
    assert.equal(connection.state?.revision, 3);
    assert.equal(socket.sent.filter(frame => frame.action).length, 1);
    assert.ok(errors.some(error => error.includes('Jam changed')));
    connection.command({ action: 'pause' });
    assert.equal(socket.sent.filter(frame => frame.action).length, 2);
    assert.equal(socket.sent.at(-1)?.expectedRevision, 3);
  } finally { connection.close(); }
});

test('captured pause retains its original revision and may noop after a peer already paused', async () => {
  const { connection, socket, errors } = setup();
  try {
    await connection.connect(); socket.open(); socket.receive({ type: 'state', state: base, serverTimeMs: 10_000 });
    socket.receive({ type: 'state', state: { ...base, revision: 2, playing: false }, serverTimeMs: 10_000 });
    connection.command({ action: 'pause' }, base);
    assert.equal(socket.sent.at(-1)?.action, 'pause');assert.equal(socket.sent.at(-1)?.expectedRevision, 1);
    const pause = socket.sent.at(-1)!;
    socket.receive({ type: 'result', id: pause.id, outcome: 'noop', state: { ...base, revision: 2, playing: false }, serverTimeMs: 10_000 });
    socket.receive({ type: 'state', state: { ...base, revision: 3, playing: true }, serverTimeMs: 10_000 });
    const count = socket.sent.length;
    connection.command({ action: 'pause' }, base);
    assert.equal(socket.sent.length, count, 'A captured old Pause cannot be restamped over a newer Play');
    assert.ok(errors.some(error => error.includes('Jam changed')));
  } finally { connection.close(); }
});

test('personal prepared headers remain identical behind an acknowledged progress sample', async () => {
  const { connection, socket } = setup();
  const state: JamState = { ...base, queue: [{ ...base.queue[0], key: 'one' }], personal: {
    explicitEnd: 1, tailKind: null, label: null, repeat: 'off', keepPlaying: false,
    cursor: null, output: null, disconnected: false,
  } };
  const prepared = { action: 'enqueue' as const, id: 'durable-edit', epoch: state.epoch,
    expectedRevision: state.revision, occurrence: state.occurrence, expectedOutput: null,
    entry: { ...base.queue[0], key: 'two' } };
  try {
    await connection.connect(); socket.open(); socket.receive({ type: 'state', state, serverTimeMs: 10_000 });
    connection.command({ action: 'progress', positionMs: 1_500 });
    const progress = socket.sent.find(frame => frame.action)!;
    connection.enqueuePrepared({ ...prepared });
    socket.receive({ type: 'result', id: progress.id, outcome: 'applied',
      state: { ...state, revision: 2, positionMs: 1_500 }, serverTimeMs: 10_000 });
    assert.deepEqual(socket.sent.filter(frame => frame.action)[1], prepared);
  } finally { connection.close(); }
});
