import {
	encapsulate, formatWantMacHeader, MAC_HEADER, parseMacHeader, RECORD_MAC_TYPE,
	verifyRecord, WANT_MAC_HEADER
} from '@atproto/space';
import type { Agent, Auth, Did } from './auth-state';
import { credentialFor, signedFetch, type SpaceAudioTransport } from './gated-audio-shared';
import { didDocument, pdsEndpoint } from './identity';

import { JAM_SPACE, JAM_COORDINATOR_URL, JAM_SERVICE_AUDIENCE, JAM_JOIN_METHOD } from './auth-config';

const { type, collection } = JAM_SPACE;

export function jamSpace(agent: Agent, did: Did, host: Did, key: string, transport: SpaceAudioTransport) {
	if (!/^did:(plc|web):[^/?#]+$/.test(host) || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
		throw new Error('Invalid Jam link');
	}

	const space = `at://${host}/space/${type}/${key}`;
	const record = { space, repo: host, collection, rkey: 'self' };

	async function hostWrite(method: string, body: object) {
		if (did !== host) throw new Error('Only the host can change this Jam');
		const response = await agent.handle(`/xrpc/com.atproto.${method}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!response.ok) throw new Error(`Jam request failed (${response.status})`);
	}

	return {
		create: () => hostWrite('space.createSpace', {
			spaceType: type,
			skey: key,
			policy: {
				$type: 'com.atproto.memberspace.policy',
				publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false
			}
		}),
		invite: (member: Did) => hostWrite('memberspace.putMember', {
			space, did: member, read: true, write: false
		}),
		publish: (snapshot: object) => hostWrite('space.putRecord', {
			...record, record: { ...snapshot, $type: collection }
		}),
		async read(): Promise<unknown> {
			const [endpoint, doc] = await Promise.all([pdsEndpoint(host), didDocument(host)]);
			const kem = doc.verificationMethod?.find(method => method.id === `${host}#atproto_kem`)?.publicKeyMultibase;
			if (!kem) throw new Error('Jam host has no verification key');
			const [{ keyShare, sharedSecret }, credential] = await Promise.all([
				encapsulate(`did:key:${kem}`),
				credentialFor(agent, space, endpoint, transport)
			]);
			const response = await signedFetch(
				transport, credential,
				`${endpoint}/xrpc/com.atproto.space.getRecord?${new URLSearchParams(record)}`, host,
				{ [WANT_MAC_HEADER]: formatWantMacHeader(RECORD_MAC_TYPE, keyShare) }
			);
			if (!response.ok) throw new Error('Could not read this Jam');
			const value = await response.json() as Parameters<typeof verifyRecord>[0];
			const uri = `${space}/${host}/${collection}/self`;
			const mac = parseMacHeader(response.headers.get(MAC_HEADER) ?? undefined, RECORD_MAC_TYPE);
			if (value.value?.$type !== collection || !await verifyRecord(value, { uri, mac, sharedSecret })) {
				throw new Error('Could not verify this Jam');
			}
			return value.value;
		}
	};
}

export interface InitialJam {
  queue: { id: string; uri: string; cid: string; durationMs: number }[];
  index?: number;
  playing?: boolean;
  positionMs?: number;
}

export async function joinJam(auth: Auth, host: Did, key: string, initial?: InitialJam): Promise<{ ticket: string; websocketUrl: string }> {
  if (!auth.agent) throw new Error('Sign in to join this Jam');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const space = `at://${host}/space/${JAM_SPACE.type}/${key}`;
    const [service, delegation] = await Promise.all([
      auth.agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: JAM_SERVICE_AUDIENCE, lxm: JAM_JOIN_METHOD })}`, { signal: controller.signal }),
      auth.agent.handle(`/xrpc/com.atproto.space.getDelegationToken?${new URLSearchParams({ space })}`, { method: 'GET', signal: controller.signal })
    ]);
    if (!service.ok) throw new Error('Enable Jams again to allow real-time playback');
    if (!delegation.ok) throw new Error('Your account cannot access this Jam');
    const serviceBody = await service.json() as { token?: unknown };
    const delegationBody = await delegation.json() as { token?: unknown };
    if (typeof serviceBody.token !== 'string' || typeof delegationBody.token !== 'string') throw new Error('Could not authorize this Jam');
    const response = await fetch(`${JAM_COORDINATOR_URL}/v1/jams/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ host, key, serviceToken: serviceBody.token, delegationToken: delegationBody.token, initial })
    });
    const body = await response.json() as { ticket?: unknown; error?: { message?: string } };
    if (!response.ok || typeof body.ticket !== 'string') throw new Error(body.error?.message || 'Could not connect to this Jam');
    const socket = new URL('/v1/jams/socket', JAM_COORDINATOR_URL);
    socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
    socket.searchParams.set('ticket', body.ticket);
    return { ticket: body.ticket, websocketUrl: socket.toString() };
  } finally { clearTimeout(timer); }
}
