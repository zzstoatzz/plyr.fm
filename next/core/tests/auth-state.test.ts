import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthState, type Did } from '../src/auth-state.ts';
import type { AuthConfig } from '../src/auth-config.ts';

const never = () => false;
const config = {
  BASE_SCOPE_PARTS: [], SCOPE_PARTS: [], SYNC_SCOPE_PARTS: [],
  hasJamGrant: never, hasSyncGrant: never, hasPrivatePublishGrant: never, hasPrivateDeleteGrant: never, hasUploadGrant: never,
  hasDownloadGrant: never, hasPolicyGrant: never, hasCommentGrant: never, hasCloseGrant: never, hasReportGrant: never, hasModeratorGrant: never
} as unknown as AuthConfig;
const agent = () => ({ handle: async () => new Response('{}') });

test('a subscriber that throws on an account switch leaves the switch whole', async () => {
  const auth = createAuthState(config, a => a);
  const seen: (string | null)[] = [];
  const thrown: unknown[] = [];
  const original = globalThis.reportError;
  globalThis.reportError = (error: unknown) => { thrown.push(error); };
  try {
    auth.subscribe(() => { if (auth.getAuth().did === 'did:plc:b') throw new TypeError('like button read a track that was gone'); });
    auth.subscribe(() => { seen.push(auth.getAuth().did); });
    auth.setAuth('did:plc:a' as Did, agent(), 'atproto');
    assert.doesNotThrow(() => auth.setAuth('did:plc:b' as Did, agent(), 'atproto'));
    auth.setAuth('did:plc:a' as Did, agent(), 'atproto');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(seen, ['did:plc:a', 'did:plc:b', 'did:plc:a']);
    assert.equal(auth.getAuth().did, 'did:plc:a');
    assert.equal(thrown.length, 1, 'the error still surfaces, after every subscriber ran');
  } finally { globalThis.reportError = original; }
});
