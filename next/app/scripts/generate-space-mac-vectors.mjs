import { writeFileSync } from 'node:fs';
import { P256Keypair, formatDidKey, P256_JWT_ALG } from '@atproto/crypto';
import { cidForCbor } from '@atproto/lex-data';
import { encode } from '@atproto/lex-cbor';
import { createCommitMacHeaders, createRecordMacHeaders, decapsulate, formatMacRequest, parseMacRequest, COMMIT_MAC_PROFILE, RECORD_MAC_PROFILE } from '@atproto/space';

const authorPrivateKey = '62c3868357a464f8461d03aa0182c7cebcde841036aea7230ddc7339f1088346';
const encapsulatedKey = '04d804370b7e24b94749eb1dc8df6d4d4a5d75f9effad01739ebcad5c54a40d57aaa8b4190fc124dbde2e4f1e1d1b012a3bc4038157dc29b55533a932306d8d38d';
const author = await P256Keypair.import(Buffer.from(authorPrivateKey, 'hex'));
const keyShare = formatDidKey(P256_JWT_ALG, Buffer.from(encapsulatedKey, 'hex'));
const sharedSecret = decapsulate(author, keyShare);
const repo = 'did:plc:fixture';
const space = `at://${repo}/space/fm.plyr.privateMedia/self`;
const commit = { ver: 1, repo, space, rev: '3mwcj3b6uak2f', data: new Uint8Array(32).fill(1) };
const uri = `${space}/${repo}/fm.plyr.track/song`;
const value = { $type: 'fm.plyr.track', title: 'SDK proof fixture' };
const cid = await cidForCbor(encode(value));
const params = profile => ({ ...parseMacRequest(formatMacRequest(profile, keyShare), profile), sharedSecret });
const fixture = {
  upstream: 'bluesky-social/atproto@2d4a6736f5ce0202945c5fb794486d3d78d1f85d',
  authorPrivateKey, keyShare, sharedSecret: Buffer.from(sharedSecret).toString('hex'),
  commit: { ...commit, data: { $bytes: Buffer.from(commit.data).toString('base64') } },
  commitHeaders: createCommitMacHeaders(commit, params(COMMIT_MAC_PROFILE)).headers,
  record: { uri, cid: cid.toString(), value },
  recordHeaders: createRecordMacHeaders(uri, cid, params(RECORD_MAC_PROFILE)).headers
};
writeFileSync(new URL('../../../backend/tests/fixtures/space-mac.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
