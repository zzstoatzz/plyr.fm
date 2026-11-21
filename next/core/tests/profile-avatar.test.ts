import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackGraphemes, graphemes, shownAvatar } from '../src/profile-avatar.ts';

test('a picked photo wins over everything', () => {
	assert.deepEqual(shownAvatar({ picked: 'blob:x', cleared: true, stored: 'p', bluesky: 'b' }), { url: 'blob:x', source: 'new' });
});

test('a saved plyr photo shows until it is cleared', () => {
	assert.deepEqual(shownAvatar({ cleared: false, stored: 'p', bluesky: 'b' }), { url: 'p', source: 'plyr' });
	assert.deepEqual(shownAvatar({ cleared: true, stored: 'p', bluesky: 'b' }), { url: 'b', source: 'bluesky' });
});

test('with no plyr photo the bluesky face shows, the way the catalog falls back', () => {
	assert.deepEqual(shownAvatar({ cleared: false, bluesky: 'b' }), { url: 'b', source: 'bluesky' });
	assert.deepEqual(shownAvatar({ cleared: false }), { source: 'none' });
});

test('the bio counter counts what people see, not code units', () => {
	assert.equal(graphemes('hi'), 2);
	assert.equal(graphemes('👩‍👩‍👧'), 1);
	assert.equal(graphemes('é'), 1);
});

test('without Intl.Segmenter (Hermes) emoji still count once', () => {
	for (const text of ['hi', '👩‍👩‍👧', 'é', '👍🏽', '🇺🇸🇫🇷', '1️⃣', 'café ☕️']) assert.equal(fallbackGraphemes(text), graphemes(text), text);
});
