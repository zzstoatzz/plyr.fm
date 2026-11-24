import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumIdFromUri, canonicalId, playlistIdFromUri, trackIdFromUri, uriFromId } from '../src/record-ids.ts';

test('an id decodes back to its AT-URI', () => {
	const uri = 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.track/3m123abc';
	assert.equal(uriFromId(trackIdFromUri(uri)), uri);
	assert.equal(uriFromId(albumIdFromUri('at://did:plc:a/fm.plyr.list/x')), 'at://did:plc:a/fm.plyr.list/x');
	assert.equal(uriFromId(uri), uri);
	for (const other of ['missing-track', 'trk_', 'alb_fixture', 'trk_!!', '42']) assert.equal(uriFromId(other), other);
});

test('plyr.fm records from plc accounts get short ids, and long ids still decode', () => {
	const uri = 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/3n2zqt7q3v522';
	const long = 'trk_YXQ6Ly9kaWQ6cGxjOmEzdnEzaGpsa3oybmJmNjdicHY1ejZxcy9mbS5wbHlyLnRyYWNrLzNuMnpxdDdxM3Y1MjI';
	assert.equal(trackIdFromUri(uri), 'trk_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522');
	assert.equal(uriFromId(trackIdFromUri(uri)), uri);
	assert.equal(uriFromId(long), uri);
	assert.equal(canonicalId(long), trackIdFromUri(uri));
	assert.equal(canonicalId(trackIdFromUri(uri)), trackIdFromUri(uri));
	for (const kept of ['42', 'missing-track', 'did:plc:a3vq3hjlkz2nbf67bpv5z6qs|3n2zqt7q3v522']) assert.equal(canonicalId(kept), kept);
	const list = 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.list/3n2zqt7q3v522';
	assert.equal(albumIdFromUri(list), 'alb_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522');
	assert.equal(uriFromId(playlistIdFromUri(list)), list);
	// the short form covers only plyr.fm's own collections on did:plc
	for (const other of ['at://did:web:plyr.fm/fm.plyr.track/live-radio', 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.dev.track/3n2', 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/a:b']) {
		assert.ok(!trackIdFromUri(other).includes('.'));
		assert.equal(uriFromId(trackIdFromUri(other)), other);
	}
	assert.ok(!albumIdFromUri(uri).includes('.'), 'a track uri is not an album');
});

test('long track ids saved before short ids come back short', async () => {
	const { pendingPlay } = await import('../src/play-outbox.ts');
	const { durableQueueEdit } = await import('../src/queue-mutation.ts');
	const uri = 'at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/3n2zqt7q3v522';
	const long = 'trk_YXQ6Ly9kaWQ6cGxjOmEzdnEzaGpsa3oybmJmNjdicHY1ejZxcy9mbS5wbHlyLnRyYWNrLzNuMnpxdDdxM3Y1MjI';
	const occurrenceId = '6f1c2a5e-3b4d-4e8f-9a0b-1c2d3e4f5a6b';
	assert.equal(pendingPlay({ trackId: long, occurrenceId, createdAt: 1 })?.trackId, trackIdFromUri(uri));
	const edit = durableQueueEdit({ action: 'enqueue', entry: { key: 'a', id: long, uri, cid: 'cid', durationMs: 1 } });
	assert.equal(edit?.action === 'enqueue' && edit.entry.id, trackIdFromUri(uri));
});
