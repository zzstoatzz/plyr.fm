#!/usr/bin/env node
// TestFlight for next/app, without going through `eas submit`.
//
//   node scripts/testflight.mjs status [count]   newest builds as App Store Connect sees them
//   node scripts/testflight.mjs upload <ipa>     validate, then upload straight to Apple with altool
//   node scripts/testflight.mjs wait <build>     poll until the build is available to internal testers
//   node scripts/testflight.mjs external [build] outside testers: add the build (default newest VALID) to
//                                                every external group, submit it for beta review, make sure
//                                                the "Public" group exists with its public link on, print state
//   node scripts/testflight.mjs invite <email>   add an outside tester to the external "Friends" group (this app
//                                                only, never an internal group) and send the invite if a build
//                                                is installable
//
// Outside testers (external groups) only get builds that passed Apple's beta app review. Internal groups
// ("Team (Expo)") are App Store Connect team members and see every app on the account, so testers who
// should only get plyr.fm always go in an external group.
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

async function api(key, method, route, body) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${route}`, {
    method,
    headers: { authorization: `Bearer ${jwt(key)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`${method} ${route} -> ${response.status}: ${JSON.stringify(json.errors ?? json)}`);
    error.status = response.status;
    error.codes = (json.errors ?? []).map(e => e.code);
    throw error;
  }
  return json;
}

const PUBLIC_GROUP = 'Public';
const FRIENDS_GROUP = 'Friends';

async function externalGroups(key) {
  const { data } = await api(key, 'GET', `/v1/apps/${ascAppId}/betaGroups?limit=50`);
  return data.filter(group => !group.attributes.isInternalGroup);
}

async function buildReview(key, version) {
  const query = new URLSearchParams({ 'filter[app]': ascAppId, sort: '-uploadedDate', limit: '10', include: 'buildBetaDetail,betaAppReviewSubmission' });
  if (version) query.set('filter[version]', String(version));
  const body = await api(key, 'GET', `/v1/builds?${query}`);
  const included = new Map((body.included ?? []).map(item => [`${item.type}:${item.id}`, item.attributes]));
  return body.data
    .map(b => ({
      id: b.id,
      build: b.attributes.version,
      processing: b.attributes.processingState,
      expired: b.attributes.expired,
      external: included.get(`buildBetaDetails:${b.relationships.buildBetaDetail?.data?.id}`)?.externalBuildState,
      review: included.get(`betaAppReviewSubmissions:${b.relationships.betaAppReviewSubmission?.data?.id}`)?.betaReviewState ?? null,
    }))
    .find(b => b.processing === 'VALID' && !b.expired);
}

async function external(version) {
  const key = await ascKey();
  const build = await buildReview(key, version);
  if (!build) throw new Error(`no VALID unexpired build${version ? ` ${version}` : ''}`);
  let groups = await externalGroups(key);
  if (!groups.some(g => g.attributes.name === PUBLIC_GROUP)) {
    const { data } = await api(key, 'POST', '/v1/betaGroups', {
      data: { type: 'betaGroups', attributes: { name: PUBLIC_GROUP, feedbackEnabled: true },
        relationships: { app: { data: { type: 'apps', id: ascAppId } } } },
    });
    console.log(`created external group ${PUBLIC_GROUP}`);
    groups = [...groups, data];
  }
  for (const group of groups) {
    await api(key, 'POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
    console.log(`build ${build.build} is in ${group.attributes.name}`);
  }
  if (!build.review) {
    const { data } = await api(key, 'POST', '/v1/betaAppReviewSubmissions', {
      data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
    build.review = data.attributes.betaReviewState;
    console.log(`submitted build ${build.build} for beta review`);
  }
  console.log(`build ${build.build}: beta review ${build.review}, external ${build.external}`);
  const pub = groups.find(g => g.attributes.name === PUBLIC_GROUP);
  if (!pub.attributes.publicLinkEnabled) {
    try {
      await api(key, 'PATCH', `/v1/betaGroups/${pub.id}`, {
        data: { type: 'betaGroups', id: pub.id, attributes: { publicLinkEnabled: true, publicLinkLimitEnabled: false } },
      });
    } catch (error) {
      console.log(`public link not on yet (Apple turns it on only once a build passed review): ${error.message}`);
    }
  }
  const { data: fresh } = await api(key, 'GET', `/v1/betaGroups/${pub.id}`);
  console.log(`public link: ${fresh.attributes.publicLinkEnabled ? fresh.attributes.publicLink : 'off'}`);
}

async function invite(email) {
  if (!email) throw new Error('usage: invite <email>');
  const key = await ascKey();
  const friends = (await externalGroups(key)).find(g => g.attributes.name === FRIENDS_GROUP);
  if (!friends) throw new Error(`no external ${FRIENDS_GROUP} group`);
  const found = await api(key, 'GET', `/v1/betaTesters?${new URLSearchParams({ 'filter[email]': email, limit: '1' })}`);
  let tester = found.data[0];
  if (!tester) {
    tester = (await api(key, 'POST', '/v1/betaTesters', {
      data: { type: 'betaTesters', attributes: { email }, relationships: { betaGroups: { data: [{ type: 'betaGroups', id: friends.id }] } } },
    })).data;
  } else {
    await api(key, 'POST', `/v1/betaGroups/${friends.id}/relationships/betaTesters`, { data: [{ type: 'betaTesters', id: tester.id }] });
  }
  console.log(`${email} is in ${FRIENDS_GROUP}`);
  try {
    await api(key, 'POST', '/v1/betaTesterInvitations', {
      data: { type: 'betaTesterInvitations', relationships: { app: { data: { type: 'apps', id: ascAppId } }, betaTester: { data: { type: 'betaTesters', id: tester.id } } } },
    });
    console.log('invite sent');
  } catch (error) {
    if (!error.codes?.some(code => /NO_INSTALLABLE_BUILDS/.test(code)) && error.status !== 409) throw error;
    console.log('no build has passed beta review yet: Apple emails the invite once one does');
  }
  const state = (await api(key, 'GET', `/v1/betaTesters/${tester.id}`)).data.attributes.state ?? 'NOT_INVITED';
  const apps = (await api(key, 'GET', `/v1/betaTesters/${tester.id}/apps?limit=50`)).data.map(a => a.attributes.bundleId);
  console.log(`${email}: ${state}; apps: ${apps.join(', ')}`);
  if (apps.some(bundle => bundle !== expo.ios.bundleIdentifier)) throw new Error(`${email} can see other apps: ${apps.join(', ')}`);
}

const [command, argument] = process.argv.slice(2);
const timeoutFlag = process.argv.indexOf('--timeout');
const timeout = timeoutFlag > 0 ? Number(process.argv[timeoutFlag + 1]) : 45;
const commands = {
  status: () => status(argument),
  upload: () => upload(argument),
  wait: () => wait(argument, timeout),
  external: () => external(argument),
  invite: () => invite(argument),
};
if (!commands[command]) {
  console.error('usage: testflight.mjs status [count] | upload <ipa> | wait <build> [--timeout minutes] | external [build] | invite <email>');
  process.exit(2);
}
commands[command]().catch(error => {
  console.error(error.message);
  process.exit(1);
});
