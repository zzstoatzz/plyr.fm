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

// playlists are fm.plyr.*.list records with listType "playlist". edits are a
// read-modify-write of the whole record, guarded by swapRecord so a
// concurrent edit from another client fails instead of being clobbered.

type Nsid = `${string}.${string}.${string}`;
const LIST = () => NSID.list as Nsid;

export interface ListRecord {
	$type?: string;
	name?: string;
	listType?: string;
	items: { subject: { uri: string; cid: string } }[];
	createdAt: string;
	updatedAt?: string;
}

const MAX_ITEMS = 500;

function rkeyOf(uri: string): string {
	return uri.split('/').pop()!;
}

async function readList(uri: string): Promise<{ value: ListRecord; cid: string }> {
	const { rpc, did } = session();
	if (!uri.startsWith(`at://${did}/`)) throw new Error('not your playlist');
	const res = await ok(
		rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection: LIST(), rkey: rkeyOf(uri) } })
	);
	return { value: res.value as unknown as ListRecord, cid: res.cid! };
}

async function writeList(uri: string, value: ListRecord, swap: string): Promise<AwaitStatus> {
	const { rpc, did } = session();
	const res = await ok(
		rpc.post('com.atproto.repo.putRecord', {
			input: {
				repo: did,
				collection: LIST(),
				rkey: rkeyOf(uri),
				record: { ...value, $type: NSID.list, updatedAt: new Date().toISOString() },
				swapRecord: swap
			}
		})
	);
	return (await api.awaitRecord(res.uri, res.cid)).status;
}

export async function createPlaylist(name: string, first?: Track): Promise<{ uri: string; status: AwaitStatus }> {
	const { rpc, did } = session();
	const items = first?.record.cid ? [{ subject: { uri: first.record.uri, cid: first.record.cid } }] : [];
	const res = await ok(
		rpc.post('com.atproto.repo.createRecord', {
			input: {
				repo: did,
				collection: LIST(),
				record: { $type: NSID.list, name: name.trim().slice(0, 64), listType: 'playlist', items, createdAt: new Date().toISOString() }
			}
		})
	);
	return { uri: res.uri, status: (await api.awaitRecord(res.uri, res.cid)).status };
}

export async function addToPlaylist(playlistUri: string, track: Track): Promise<AwaitStatus> {
	if (!track.record.cid) throw new Error('track has no verified cid');
	const { value, cid } = await readList(playlistUri);
	if (value.items.some((i) => i.subject.uri === track.record.uri)) return 'indexed';
	if (value.items.length >= MAX_ITEMS) throw new Error(`playlists hold at most ${MAX_ITEMS} tracks`);
	value.items = [...value.items, { subject: { uri: track.record.uri, cid: track.record.cid } }];
	return writeList(playlistUri, value, cid);
}

export async function removeFromPlaylist(playlistUri: string, trackUri: string): Promise<AwaitStatus> {
	const { value, cid } = await readList(playlistUri);
	value.items = value.items.filter((i) => i.subject.uri !== trackUri);
	return writeList(playlistUri, value, cid);
}

export async function renamePlaylist(playlistUri: string, name: string): Promise<AwaitStatus> {
	const { value, cid } = await readList(playlistUri);
	value.name = name.trim().slice(0, 64);
	return writeList(playlistUri, value, cid);
}

export async function deletePlaylist(playlistUri: string): Promise<AwaitStatus> {
	const { rpc, did } = session();
	await ok(rpc.post('com.atproto.repo.deleteRecord', { input: { repo: did, collection: LIST(), rkey: rkeyOf(playlistUri) } }));
	return (await api.awaitRecord(playlistUri)).status;
}
