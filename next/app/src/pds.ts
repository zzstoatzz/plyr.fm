// writes go straight to the signed-in user's PDS; the appview picks them up
import type {} from '@atcute/atproto';
// from the firehose, and /v1/records/await gives read-after-write.
import { ClientResponseError, ok } from '@atcute/client';
import { api, type AwaitStatus, type Track } from './api';
import { getAuth, type Auth } from './auth-state';
import { NSID } from './config';
import { blobUrl } from './identity';
import { catalogChanged } from './catalog-changes';
import { normalizeTrackTags } from './publishing/track-tags';


export interface MediaFile {
	name: string;
	uri?: string;
	type: string;
	size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface LikeRef {
	uri: string;
	cid: string;
	rkey: string;
	subject: { uri: string; cid: string };
}

export interface ListRecord {
	$type?: string;
	name?: string;
	listType?: string;
	items: { subject: { uri: string; cid: string } }[];
	createdAt: string;
	updatedAt?: string;
}

export const MAX_AUDIO_BYTES = 104_857_600; // track lexicon audioBlob.maxSize

export class TrackRevisionConflict extends Error {
	constructor() { super('this track changed elsewhere. reload the latest version before saving.'); }
}

export interface NewTrack {
	tags?: string[];
	file: MediaFile;
	title: string;
	artist: string;
	album?: string;
	description?: string;
	duration?: number;
	/** cover art, stored on your PDS as imageBlob */
	artwork?: MediaFile | null;
}

export interface ProfileRecord {
	$type?: string;
	displayName?: string;
	bio?: string;
	avatar?: string;
	createdAt?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

export interface TrackEdits {
	tags?: string[];
	title: string;
	album: string;
	description: string;
	/** a new cover (File), remove it (null), or keep it (undefined) */
	artwork?: MediaFile | null;
}

async function uploadBlob(rpc: NonNullable<Auth['rpc']>, file: MediaFile) {
	return ok(rpc.post('com.atproto.repo.uploadBlob', {
		input: await file.arrayBuffer(),
		headers: { 'content-type': file.type }
	}));
}

type ViewerLikes = { did: string; promise: Promise<Map<string, LikeRef>> };
const viewerLikes = new WeakMap<NonNullable<Auth['rpc']>, ViewerLikes>();

export function createPds(auth: Pick<Auth, 'did' | 'rpc'>) {
	function session() {
		if (!auth.rpc || !auth.did) throw new Error('sign in first');
		return { rpc: auth.rpc, did: auth.did as `did:${string}:${string}` };
	}

	/**
	 * the PDS accepted the write, so it is saved. waiting for the appview to
	 * index it is best-effort: a timeout or network error means "saved, still
	 * indexing", never "failed", so callers don't retry a create that already
	 * happened. a newer revision showing up first also counts as indexed.
	 */
	async function settle(uri: string, cid?: string): Promise<AwaitStatus> {
		try {
			const status = (await api.awaitRecord(uri, cid)).status;
			if (status === 'indexed' || status === 'deleted' || status === 'absent') {
				const [, owner, collection] = /^at:\/\/([^/]+)\/([^/]+)\//.exec(uri) ?? [];
				const scope = collection === NSID.track ? 'tracks' : collection === NSID.list ? 'albums' : collection === NSID.profile ? 'profile' : null;
				if (owner && scope) catalogChanged(owner, scope);
			}
			return status;
		} catch {
			return 'pending';
		}
	}




	/** the viewer's like records, read from their own PDS (authoritative). one read per session, shared by every row. */
	function myLikes(): Promise<Map<string, LikeRef>> {
		const { rpc, did } = session();
		const cached = viewerLikes.get(rpc);
		if (cached?.did === did) return cached.promise;
		const promise = (async () => {
			const out = new Map<string, LikeRef>();
			let cursor: string | undefined;
			const seen = new Set<string>();
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
						cid: r.cid,
						rkey: ownedRkey(r.uri, did, NSID.like),
						subject: value.subject
					});
				}
				cursor = data.cursor;
				if (cursor && seen.has(cursor)) throw new Error('your PDS repeated a likes page');
				if (cursor) seen.add(cursor);
			} while (cursor);
			return out;
		})();
		const entry = { did, promise };
		viewerLikes.set(rpc, entry);
		void promise.catch(() => { if (viewerLikes.get(rpc) === entry) viewerLikes.delete(rpc); });
		return promise;
	}

	async function like(track: Track, { waitForIndex = true }: { waitForIndex?: boolean } = {}): Promise<AwaitStatus> {
		const { rpc, did } = session();
		if (!track.record.cid) throw new Error('track has no verified cid');
		const subject = { uri: track.record.uri, cid: track.record.cid };
		const likes = await myLikes();
		const existing = likes.get(subject.uri);
		if (existing) return waitForIndex ? settle(existing.uri, existing.cid) : 'pending';
		const res = await ok(
			rpc.post('com.atproto.repo.createRecord', {
				input: {
					repo: did,
					collection: NSID.like as `${string}.${string}.${string}`,
					record: { $type: NSID.like, subject, createdAt: new Date().toISOString() }
				}
			})
		).catch((error: unknown) => { viewerLikes.delete(rpc); throw error; });
		likes.set(subject.uri, { uri: res.uri, cid: res.cid, rkey: ownedRkey(res.uri, did, NSID.like), subject });
		return waitForIndex ? settle(res.uri, res.cid) : 'pending';
	}

	async function unlike(track: Track, { waitForIndex = true }: { waitForIndex?: boolean } = {}): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const likes = await myLikes();
		const existing = likes.get(track.record.uri);
		if (!existing) return 'absent';
		await ok(
			rpc.post('com.atproto.repo.deleteRecord', {
				input: { repo: did, collection: NSID.like as `${string}.${string}.${string}`, rkey: existing.rkey, swapRecord: existing.cid }
			})
		).catch((error: unknown) => { viewerLikes.delete(rpc); throw error; });
		likes.delete(track.record.uri);
		return waitForIndex ? settle(existing.uri) : 'pending';
	}

	// playlists are fm.plyr.*.list records with listType "playlist". edits are a
	// read-modify-write of the whole record, guarded by swapRecord so a
	// concurrent edit from another client fails instead of being clobbered.

	type Nsid = `${string}.${string}.${string}`;
	const LIST = () => NSID.list as Nsid;



	const MAX_ITEMS = 500;

	function ownedRkey(uri: string, did: string, collection: string): string {
		const prefix = `at://${did}/${collection}/`;
		const rkey = uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
		if (!/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) throw new Error('not your record');
		return rkey;
	}

	async function readList(uri: string, kind: 'album' | 'playlist' = 'playlist'): Promise<{ value: ListRecord; cid: string }> {
		const { rpc, did } = session();
		const res = await ok(
			rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection: LIST(), rkey: ownedRkey(uri, did, LIST()) } })
		);
		const value = res.value as unknown as ListRecord;
		if (res.uri !== uri || !res.cid || value.listType !== kind) throw new Error('not an editable collection');
		return { value, cid: res.cid };
	}

	async function writeList(uri: string, value: ListRecord, swap: string): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const res = await ok(
			rpc.post('com.atproto.repo.putRecord', {
				input: {
					repo: did,
					collection: LIST(),
					rkey: ownedRkey(uri, did, LIST()),
					record: { ...value, $type: NSID.list, updatedAt: new Date().toISOString() },
					swapRecord: swap
				}
			})
		);
		return await settle(res.uri, res.cid);
	}

	async function createPlaylist(name: string, first?: Track): Promise<{ uri: string; status: AwaitStatus }> {
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
		return { uri: res.uri, status: await settle(res.uri, res.cid) };
	}

	async function addToPlaylist(playlistUri: string, track: Track): Promise<AwaitStatus> {
		if (!track.record.cid) throw new Error('track has no verified cid');
		const { value, cid } = await readList(playlistUri);
		if (value.items.some((i) => i.subject.uri === track.record.uri)) return 'indexed';
		if (value.items.length >= MAX_ITEMS) throw new Error(`playlists hold at most ${MAX_ITEMS} tracks`);
		value.items = [...value.items, { subject: { uri: track.record.uri, cid: track.record.cid } }];
		return writeList(playlistUri, value, cid);
	}

	async function removeFromPlaylist(playlistUri: string, trackUri: string): Promise<AwaitStatus> {
		const { value, cid } = await readList(playlistUri);
		value.items = value.items.filter((i) => i.subject.uri !== trackUri);
		return writeList(playlistUri, value, cid);
	}

	async function renameCollection(playlistUri: string, name: string, kind: 'album' | 'playlist'): Promise<AwaitStatus> {
		const { value, cid } = await readList(playlistUri, kind);
		value.name = name.trim().slice(0, 64);
		return writeList(playlistUri, value, cid);
	}

	async function deletePlaylist(playlistUri: string): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const rkey = ownedRkey(playlistUri, did, LIST());
		const { cid } = await readList(playlistUri);
		await ok(rpc.post('com.atproto.repo.deleteRecord', { input: { repo: did, collection: LIST(), rkey, swapRecord: cid } }));
		return await settle(playlistUri);
	}

	// uploads: the audio goes to the user's PDS as a blob and the track record
	// points at it. the appview never touches the bytes; players fetch them from
	// the PDS (see identity.blobUrl).





	async function uploadTrack(input: NewTrack): Promise<{ uri: string; status: AwaitStatus }> {
		const { rpc, did } = session();
		const tags = input.tags === undefined ? undefined : normalizeTrackTags(input.tags);
		function assertAccount() {
			if (getAuth().rpc !== rpc || getAuth().did !== did) throw new Error('account changed before publishing.');
		}
		assertAccount();
		if (!input.file.type.startsWith('audio/')) throw new Error('pick an audio file');
		if (input.file.size > MAX_AUDIO_BYTES) throw new Error('audio files are limited to 100 MB');
		const uploaded = await uploadBlob(rpc, input.file);
		assertAccount();
		const ext = input.file.name.includes('.') ? input.file.name.split('.').pop()!.toLowerCase() : '';
		const record: Record<string, unknown> = {
			$type: NSID.track,
			title: input.title.trim(),
			artist: input.artist.trim(),
			fileType: (ext || input.file.type.split('/')[1] || 'audio').slice(0, 16),
			createdAt: new Date().toISOString()
		};
		if (input.album?.trim()) record.album = input.album.trim();
		if (tags !== undefined) record.tags = tags;
		if (input.description?.trim()) record.description = input.description.trim();
		if (input.duration && Number.isFinite(input.duration)) record.duration = Math.round(input.duration);
		if (input.artwork) Object.assign(record, await uploadArtwork(input.artwork));
		assertAccount();

		const res = await ok(rpc.post('com.atproto.repo.createRecord', {
			input: { repo: did, collection: NSID.track as Nsid, record: { ...record, audioBlob: uploaded.blob } }
		}));
		return { uri: res.uri, status: await settle(res.uri, res.cid) };
	}

	// the plyr profile is one fm.plyr.*.actor.profile/self record. unknown fields
	// written by other clients are kept; swapRecord guards concurrent edits.



	const PROFILE = () => NSID.profile as Nsid;

	async function myProfile(): Promise<{ value: ProfileRecord | null; cid: string | null }> {
		const { rpc, did } = session();
		const res = await rpc.get('com.atproto.repo.getRecord', {
			params: { repo: did, collection: PROFILE(), rkey: 'self' }
		});
		if (!res.ok) {
			if (res.data.error === 'RecordNotFound') return { value: null, cid: null };
			throw new Error(res.data.message ?? res.data.error);
		}
		return { value: res.data.value as ProfileRecord, cid: res.data.cid ?? null };
	}

	async function saveProfile(
		edits: { bio: string; avatar: string },
		current: { value: ProfileRecord | null; cid: string | null }
	): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const now = new Date().toISOString();
		const record: ProfileRecord = { ...(current.value ?? {}), $type: NSID.profile, createdAt: current.value?.createdAt ?? now };
		// only fields the published fm.plyr.actor.profile lexicon has; display
		// names come from the bluesky profile (via typeahead).
		for (const key of ['bio', 'avatar'] as const) {
			const text = edits[key].trim();
			if (text) record[key] = text;
			else delete record[key];
		}
		if (current.value) record.updatedAt = now;
		const res = await ok(
			rpc.post('com.atproto.repo.putRecord', {
				input: {
					repo: did,
					collection: PROFILE(),
					rkey: 'self',
					record,
					...(current.cid ? { swapRecord: current.cid } : {})
				}
			})
		);
		return await settle(res.uri, res.cid);
	}

	// your own tracks: edits are a read-modify-write of the fm.plyr.track record,
	// keeping every field other clients (and prod) wrote; swapRecord guards races.



	/**
	 * upload cover art as a blob and return the record fields: imageBlob is the
	 * canonical cover; imageUrl is its getBlob url for clients that only read urls.
	 */
	async function uploadArtwork(file: MediaFile): Promise<{ imageBlob: unknown; imageUrl: string }> {
		const { rpc, did } = session();
		if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('choose a PNG, JPEG, WebP, or GIF cover');
		if (file.size > 10_000_000) throw new Error('cover art is limited to 10 MB');
		const uploaded = await uploadBlob(rpc, file);
		const cid = (uploaded.blob as { ref: { $link: string } }).ref.$link;
		return { imageBlob: uploaded.blob, imageUrl: await blobUrl(did, cid) };
	}

	async function editTrack(uri: string, edits: TrackEdits, revision?: Awaited<ReturnType<typeof myTrack>>): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const rkey = ownedRkey(uri, did, NSID.track);
		const tags = edits.tags === undefined ? undefined : normalizeTrackTags(edits.tags);
		const current = revision ?? await readTrack(uri, rkey);
		if (current.uri !== uri) throw new Error('track revision does not match');
		const record = { ...(current.value as Record<string, unknown>) };
		if (tags !== undefined) record.tags = tags;
		if (!edits.title.trim()) throw new Error('a track needs a title');
		record.title = edits.title.trim();
		for (const key of ['album', 'description'] as const) {
			const v = edits[key].trim();
			if (v) record[key] = v;
			else delete record[key];
		}
		if (edits.artwork === null) {
			delete record.imageBlob;
			delete record.imageUrl;
		} else if (edits.artwork) {
			Object.assign(record, await uploadArtwork(edits.artwork));
		}
		if (getAuth().rpc !== rpc || getAuth().did !== did) throw new Error('account changed before publishing.');
		const res = await ok(
			rpc.post('com.atproto.repo.putRecord', {
				input: {
					repo: did,
					collection: NSID.track as Nsid,
					rkey,
					record,
					swapRecord: current.cid
				}
			})
		).catch((error: unknown) => {
			if (error instanceof ClientResponseError && error.error === 'InvalidSwap') throw new TrackRevisionConflict();
			throw error;
		});
		return await settle(res.uri, res.cid);
	}

	async function readTrack(uri: string, rkey: string) {
		const { rpc, did } = session();
		const result = await ok(
			rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection: NSID.track as Nsid, rkey } })
		);
		if (result.uri !== uri || !result.cid) throw new Error('could not read your track revision');
		return { ...result, cid: result.cid };
	}

	async function myTrack(uri: string) {
		const { did } = session();
		return readTrack(uri, ownedRkey(uri, did, NSID.track));
	}

	async function deleteTrack(uri: string): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const rkey = ownedRkey(uri, did, NSID.track);
		const { cid } = await readTrack(uri, rkey);
		if (getAuth().rpc !== rpc || getAuth().did !== did) throw new Error('account changed before deleting.');
		await ok(
			rpc.post('com.atproto.repo.deleteRecord', {
				input: { repo: did, collection: NSID.track as Nsid, rkey, swapRecord: cid }
			})
		);
		return await settle(uri);
	}
	return { myLikes, like, unlike, createPlaylist, addToPlaylist, removeFromPlaylist, renameCollection, deletePlaylist, uploadTrack, myProfile, saveProfile, myTrack, editTrack, deleteTrack };
}
