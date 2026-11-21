import assert from 'node:assert/strict';
import test from 'node:test';
import { readableError } from '../src/api-errors.ts';

test("the appview's stock not-found message reads as plain copy", () => {
	assert.equal(readableError(404, 'The requested resource was not found.'), "this isn't on plyr.fm. it may have been deleted.");
});

test('a specific server message is kept', () => {
	assert.equal(readableError(409, 'The host needs to start this Jam'), 'The host needs to start this Jam');
});

test('a failure without a message gets plain copy for its status', () => {
	assert.equal(readableError(503, undefined), "plyr.fm couldn't finish that. try again in a moment.");
	assert.equal(readableError(401, ''), 'sign in to do that.');
});
