import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumIdFromUri, trackIdFromUri, uriFromId } from '../src/record-ids.ts';

test('an id decodes back to its AT-URI', () => {
	const uri = 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.track/3m123abc';
	assert.equal(uriFromId(trackIdFromUri(uri)), uri);
	assert.equal(uriFromId(albumIdFromUri('at://did:plc:a/fm.plyr.list/x')), 'at://did:plc:a/fm.plyr.list/x');
	assert.equal(uriFromId(uri), uri);
	for (const other of ['missing-track', 'trk_', 'alb_fixture', 'trk_!!', '42']) assert.equal(uriFromId(other), other);
});
