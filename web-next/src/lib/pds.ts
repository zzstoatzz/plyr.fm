// writes go straight to the signed-in user's PDS; the appview picks them up
import type {} from '@atcute/atproto';
// from the firehose, and /v1/records/await gives read-after-write.
import { ok } from '@atcute/client';
import { api, type AwaitStatus, type Track } from './api';
import { auth } from './auth.svelte';
import { NSID } from './config';

function session() {
	if (!auth.rpc || !auth.did) throw new Error('sign in first');
	return { rpc: auth.rpc, did: auth.did as `did:${string}:${string}` };
}

export interface LikeRef {
	uri: string;
	rkey: string;
	subject: { uri: string; cid: string };
}

let likeCache: Map<string, LikeRef> | null = null;
let likeCacheDid: string | null = null;

/** the viewer's like records, read from their own PDS (authoritative). */
export async function myLikes(): Promise<Map<string, LikeRef>> {
	const { rpc, did } = session();
	if (likeCache && likeCacheDid === did) return likeCache;
	const out = new Map<string, LikeRef>();
	let cursor: string | undefined;
	do {
		const data = await ok(
			rpc.get('com.atproto.repo.listRecords', {
				params: { repo: did, collection: NSID.like as `${string}.${string}.${string}`, limit: 100, cursor }
			})
		);
		for (const r of data.records) {
			const value = r.value as { subject?: { uri: string; cid: string } };
			if (!value.subject) continue;
			out.set(value.subject.uri, {
				uri: r.uri,
				rkey: r.uri.split('/').pop()!,
				subject: value.subject
			});
		}
		cursor = data.cursor;
	} while (cursor);
	likeCache = out;
	likeCacheDid = did;
	return out;
}

export async function like(track: Track): Promise<AwaitStatus> {
	const { rpc, did } = session();
	if (!track.record.cid) throw new Error('track has no verified cid');
	const subject = { uri: track.record.uri, cid: track.record.cid };
	const res = await ok(
		rpc.post('com.atproto.repo.createRecord', {
			input: {
				repo: did,
				collection: NSID.like as `${string}.${string}.${string}`,
				record: { $type: NSID.like, subject, createdAt: new Date().toISOString() }
			}
		})
	);
	(await myLikes()).set(subject.uri, { uri: res.uri, rkey: res.uri.split('/').pop()!, subject });
	return (await api.awaitRecord(res.uri, res.cid)).status;
}

export async function unlike(track: Track): Promise<AwaitStatus> {
	const { rpc, did } = session();
	const likes = await myLikes();
	const existing = likes.get(track.record.uri);
	if (!existing) return 'absent';
	await ok(
		rpc.post('com.atproto.repo.deleteRecord', {
			input: { repo: did, collection: NSID.like as `${string}.${string}.${string}`, rkey: existing.rkey }
		})
	);
	likes.delete(track.record.uri);
	return (await api.awaitRecord(existing.uri)).status;
}
