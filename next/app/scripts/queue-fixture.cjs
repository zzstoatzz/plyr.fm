const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, randomBytes, createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const audience = 'did:web:plyr-jams-next.fly.dev#jams';
const method = 'fm.plyr.stg.jam.join';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex')), text = '';
  while (value > 0n) { text = alphabet[Number(value % 58n)] + text; value /= 58n; }
  return text;
}
const curves = {
  p256: { name: 'prime256v1', alg: 'ES256', prefix: [0x80, 0x24], order: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n },
  k256: { name: 'secp256k1', alg: 'ES256K', prefix: [0xe7, 0x01], order: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n },
};

function identity(kind = 'p256') {
  const curve = curves[kind];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: curve.name });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  const did = 'did:plc:' + [...randomBytes(24)].map(byte => 'abcdefghijklmnopqrstuvwxyz234567'[byte % 32]).join('');
  return { did, privateKey, curve, multibase: 'z' + base58(Buffer.concat([Buffer.from([...curve.prefix, 2 + (y[31] & 1)]), x])) };
}

function serviceToken(account, { key = account.privateKey, aud = audience, lxm = method, lifetime = 60 } = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ typ: 'JWT', alg: account.curve.alg })}.${encode({ iss: account.did, aud, lxm, iat: now, exp: now + lifetime, jti: randomBytes(8).toString('hex') })}`;
  const raw = sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' });
  let low = BigInt('0x' + raw.subarray(32).toString('hex'));
  if (low > account.curve.order / 2n) low = account.curve.order - low;
  return `${body}.${Buffer.concat([raw.subarray(0, 32), Buffer.from(low.toString(16).padStart(64, '0'), 'hex')]).toString('base64url')}`;
}

// Serves the identities' DID documents and runs locally built coordinators against the test Redis.
async function startQueueFixture(accounts, { port = Number(process.env.QUEUE_TEST_PORT || 5351), count = 2 } = {}) {
  const ports = Array.from({ length: count }, (_, at) => port + at);
  const documents = Object.fromEntries(accounts.map(account => [account.did, { id: account.did,
    verificationMethod: [{ id: `${account.did}#atproto`, type: 'Multikey', controller: account.did, publicKeyMultibase: account.multibase }], service: [] }]));
  const directory = http.createServer((request, response) => {
    const document = documents[decodeURIComponent(request.url.slice(1))];
    response.writeHead(document ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(document ?? { message: 'not found' }));
  });
  await new Promise(resolve => directory.listen(port + count, '127.0.0.1', resolve));
  const keys = accounts.flatMap(account => ['state', 'commands', 'command-order', 'events'].map(suffix => `plyr:next:jam:${createHash('sha256').update(`queue:${account.did}`).digest('hex')}:${suffix}`));
  const cleanup = () => execFileSync('docker', ['compose', '-f', path.resolve(__dirname, '../../backend/compose.yaml'), 'exec', '-T', 'test-redis', 'redis-cli', 'DEL', ...keys], { stdio: 'ignore' });
  cleanup();
  const environment = { ...process.env, MODE: 'jams', INDEX_MODE: 'disabled', DOCKET_URL: 'redis://127.0.0.1:6380/0', TRACK_COLLECTION_NSID: 'fm.plyr.track', LIST_COLLECTION_NSID: 'fm.plyr.list', PROFILE_COLLECTION_NSID: 'fm.plyr.actor.profile', LIKE_COLLECTION_NSID: 'fm.plyr.like', CORS_ALLOWED_ORIGINS: 'https://next.plyr.fm', PLC_DIRECTORY_URL: `http://127.0.0.1:${port + count}` };
  delete environment.JAM_TEST_MODE; delete environment.JAM_TEST_PDS_ORIGIN;
  const children = ports.map(value => spawn(path.resolve(__dirname, '../../backend/zig-out/bin/plyr-backend'), [], { env: { ...environment, PORT: String(value) }, stdio: ['ignore', 'ignore', process.env.QUEUE_FIXTURE_LOGS ? 'inherit' : 'ignore'] }));
  const bases = ports.map(value => `http://127.0.0.1:${value}`);
  const stop = async () => { for (const child of children) child.kill('SIGTERM'); directory.close(); await new Promise(resolve => setTimeout(resolve, 100)); cleanup(); };
  try {
    for (const base of bases) {
      let healthy = false;
      for (let i = 0; i < 100; i++) { try { healthy = (await fetch(base + '/health')).ok; } catch {} if (healthy) break; await new Promise(resolve => setTimeout(resolve, 50)); }
      assert.ok(healthy, 'local coordinator ready');
    }
  } catch (error) { await stop(); throw error; }
  return { bases, stop };
}

module.exports = { identity, serviceToken, startQueueFixture };
