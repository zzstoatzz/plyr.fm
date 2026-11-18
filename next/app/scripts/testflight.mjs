#!/usr/bin/env node
// TestFlight for next/app, without going through `eas submit`.
//
//   node scripts/testflight.mjs status [count]   newest builds as App Store Connect sees them
//   node scripts/testflight.mjs upload <ipa>     validate, then upload straight to Apple with altool
//   node scripts/testflight.mjs wait <build>     poll until the build is available to internal testers
//
// "wait" exits 0 only when the build is processingState VALID and internalBuildState
// IN_BETA_TESTING, which is the only state in which it is on a tester's phone. It exits 1 on
// INVALID/FAILED or after --timeout minutes (default 45).
//
// Credentials: the App Store Connect API key EAS already holds for submissions, read through
// the EAS GraphQL API with EXPO_TOKEN or the `eas login` session in ~/.expo/state.json. The key
// stays in memory: it signs the API JWT and reaches altool through --auth-string, never a file.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expo = JSON.parse(readFileSync(path.join(app, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(path.join(app, 'eas.json'), 'utf8'));
const fullName = `@${expo.owner}/${expo.slug}`;
const ascAppId = eas.submit.production.ios.ascAppId;

function expoHeaders() {
  if (process.env.EXPO_TOKEN) return { authorization: `Bearer ${process.env.EXPO_TOKEN}` };
  const statePath = path.join(os.homedir(), '.expo/state.json');
  const secret = existsSync(statePath) && JSON.parse(readFileSync(statePath, 'utf8')).auth?.sessionSecret;
  if (!secret) throw new Error('not logged in to EAS: run `eas login` or set EXPO_TOKEN');
  return { 'expo-session': secret };
}

async function ascKey() {
  const response = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...expoHeaders() },
    body: JSON.stringify({
      query: `query ($fullName: String!) { app { byFullName(fullName: $fullName) {
        iosAppCredentials { appStoreConnectApiKeyForSubmissions { keyIdentifier issuerIdentifier keyP8 } } } } }`,
      variables: { fullName },
    }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(`EAS: ${JSON.stringify(body.errors)}`);
  const key = body.data.app.byFullName.iosAppCredentials
    .map(credentials => credentials.appStoreConnectApiKeyForSubmissions)
    .find(Boolean);
  if (!key) throw new Error(`EAS holds no App Store Connect API key for ${fullName}`);
  return key;
}

function jwt(key) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'ES256', kid: key.keyIdentifier, typ: 'JWT' })}.${encode({
    iss: key.issuerIdentifier, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1',
  })}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: key.keyP8, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

async function builds(key, { version, limit = 10 } = {}) {
  const query = new URLSearchParams({
    'filter[app]': ascAppId,
    sort: '-uploadedDate',
    limit: String(limit),
    include: 'buildBetaDetail,betaGroups',
    'fields[betaGroups]': 'name',
  });
  if (version) query.set('filter[version]', String(version));
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/builds?${query}`, {
    headers: { authorization: `Bearer ${jwt(key)}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`App Store Connect ${response.status}: ${JSON.stringify(body.errors)}`);
  const included = new Map((body.included ?? []).map(item => [`${item.type}:${item.id}`, item.attributes]));
  return body.data.map(({ attributes, relationships }) => ({
    build: attributes.version,
    uploaded: attributes.uploadedDate,
    processing: attributes.processingState,
    expired: attributes.expired,
    internal: included.get(`buildBetaDetails:${relationships.buildBetaDetail?.data?.id}`)?.internalBuildState,
    groups: (relationships.betaGroups?.data ?? []).map(group => included.get(`betaGroups:${group.id}`)?.name ?? group.id),
  }));
}

const line = b =>
  `${b.build}\t${b.uploaded}\t${b.processing}${b.expired ? ' EXPIRED' : ''}\t${b.internal ?? '-'}\t${b.groups.join(', ') || '-'}`;

async function status(count) {
  const key = await ascKey();
  console.log('build\tuploaded\tprocessing\tinternal testing\tgroups');
  for (const b of await builds(key, { limit: Number(count) || 10 })) console.log(line(b));
}

function run(command, args, secret) {
  const scrub = chunk => chunk.toString().split(secret).join('<redacted>');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => process.stdout.write(scrub(chunk)));
    child.stderr.on('data', chunk => process.stderr.write(scrub(chunk)));
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${args[1]} exited ${code}`))));
  });
}

async function upload(ipa) {
  if (!ipa || !existsSync(ipa)) throw new Error(`no ipa at ${ipa}`);
  const key = await ascKey();
  // altool takes the bare base64 body of the .p8. It is visible in `ps` while altool runs.
  const body = key.keyP8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const auth = ['--api-key', key.keyIdentifier, '--api-issuer', key.issuerIdentifier, '--auth-string', body];
  for (const step of ['--validate-app', '--upload-app']) {
    const started = Date.now();
    await run('xcrun', ['altool', step, '-f', ipa, '-t', 'ios', ...auth, '--output-format', 'normal'], body);
    console.log(`${step.slice(2)} ok in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  console.log('uploaded. this is not "in TestFlight" yet: run `wait <build>`.');
}

async function wait(version, timeoutMinutes) {
  if (!version) throw new Error('usage: wait <build number>');
  const key = await ascKey();
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let last = '';
  for (;;) {
    const [b] = await builds(key, { version, limit: 1 });
    const now = new Date().toISOString();
    const current = b ? line(b) : `${version}\tnot in App Store Connect yet`;
    if (current !== last) console.log(`${now}\t${current}`);
    last = current;
    if (b?.processing === 'VALID' && b.internal === 'IN_BETA_TESTING') {
      console.log(`build ${version} is available to internal testers (${b.groups.join(', ')}).`);
      return;
    }
    if (b && ['INVALID', 'FAILED'].includes(b.processing)) throw new Error(`build ${version} is ${b.processing}`);
    if (b?.internal && /MISSING_EXPORT_COMPLIANCE|PROCESSING_EXCEPTION|EXPIRED/.test(b.internal)) {
      throw new Error(`build ${version} is ${b.internal}`);
    }
    if (Date.now() > deadline) throw new Error(`build ${version} not available after ${timeoutMinutes} min`);
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

const [command, argument] = process.argv.slice(2);
const timeoutFlag = process.argv.indexOf('--timeout');
const timeout = timeoutFlag > 0 ? Number(process.argv[timeoutFlag + 1]) : 45;
const commands = { status: () => status(argument), upload: () => upload(argument), wait: () => wait(argument, timeout) };
if (!commands[command]) {
  console.error('usage: testflight.mjs status [count] | upload <ipa> | wait <build> [--timeout minutes]');
  process.exit(2);
}
commands[command]().catch(error => {
  console.error(error.message);
  process.exit(1);
});
