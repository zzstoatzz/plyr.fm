import {
	encapsulate, formatWantMacHeader, MAC_HEADER, parseMacHeader, RECORD_MAC_TYPE,
	verifyRecord, WANT_MAC_HEADER
} from '@atproto/space';
import type { Agent, Did } from './auth-state';
import { credentialFor, signedFetch, type SpaceAudioTransport } from './gated-audio-shared';
import { didDocument, pdsEndpoint } from './identity';

import { JAM_SPACE } from './auth-config';

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
