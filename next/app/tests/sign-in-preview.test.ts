import assert from 'node:assert/strict';
import test from 'node:test';
import { signInPreview } from '../src/sign-in-preview.ts';

function serve(routes: Record<string, unknown>) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    return url in routes ? Response.json(routes[url]) : new Response('', { status: 404 });
  }) as typeof fetch;
  return seen;
}

const profile = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=';

test('a handle previews its profile and the host its PDS signs in on', async () => {
  serve({
    [profile + 'nate.example']: { did: 'did:plc:abc', handle: 'nate.example', displayName: 'nate', avatar: 'https://cdn.example/a.jpg' },
    'https://plc.directory/did:plc:abc': { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example/' }] },
    'https://pds.example/.well-known/oauth-protected-resource': { authorization_servers: ['https://auth.example'] },
  });
  assert.deepEqual(await signInPreview('nate.example', new AbortController().signal), {
    handle: 'nate.example', display_name: 'nate', avatar_url: 'https://cdn.example/a.jpg', sign_in_host: 'auth.example',
  });
});

test('a did:web account reads its own DID document', async () => {
  const seen = serve({
    [profile + 'did%3Aweb%3Aexample.com']: { did: 'did:web:example.com', handle: 'example.com' },
    'https://example.com/.well-known/did.json': { service: [{ id: 'did:web:example.com#atproto_pds', serviceEndpoint: 'https://example.com' }] },
    'https://example.com/.well-known/oauth-protected-resource': { authorization_servers: ['https://example.com'] },
  });
  const preview = await signInPreview('did:web:example.com', new AbortController().signal);
  assert.equal(preview?.sign_in_host, 'example.com');
  assert.equal(preview?.display_name, undefined);
  assert.ok(seen.includes('https://example.com/.well-known/did.json'));
});

test('an unknown account has no preview, and an unreachable PDS only drops the host', async () => {
  serve({});
  assert.equal(await signInPreview('gone.example', new AbortController().signal), undefined);
  serve({ [profile + 'lone.example']: { did: 'did:plc:lone', handle: 'lone.example' } });
  assert.deepEqual(await signInPreview('lone.example', new AbortController().signal), { handle: 'lone.example', display_name: undefined, avatar_url: undefined, sign_in_host: undefined });
});
