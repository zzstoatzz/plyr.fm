import { publicTrackReference, assertPublicCollection } from './publishing/track-reference';
import { repoOk as ok, getRecord, listRecords, createRecord, putRecord, uploadRepoBlob, type RepoRpc } from './publishing/repo-rpc';
import type { createApi, AwaitStatus, Track } from './api';
import type { Auth } from './auth-state';
import type { AuthConfig } from './auth-config';
import { blobUrl } from './identity';
import { normalizeTrackTags } from './publishing/track-tags';
import { ARTWORK_TYPES, MAX_ARTWORK_BYTES } from './publishing/artwork-model';
import { recordCreator, CreateUnconfirmed } from './publishing/create-record';
import { sameRecord, type CreateOperation, type CreateReservation, type CreateStorage } from './publishing/create-operation';
import { albumPublishing } from './collections/album-pds';
import { collectionOrdering } from './collections/collection-order-pds';
import { MAX_AUDIO_BYTES } from './publishing/track-audio';
import { trackEditor } from './publishing/track-pds';
import { assertPublicUploadRecord } from './publishing/upload-model';
import type { MediaFile } from './publishing/private-music';
import type { CatalogScope } from './catalog/changes';

export type { MediaFile } from './publishing/private-music';

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

export { MAX_AUDIO_BYTES } from './publishing/track-audio';

export { TrackRevisionConflict, type TrackEdits } from './publishing/track-pds';

export interface NewTrack {
	tags?: string[];
	file: MediaFile;
	title: string;
	artist: string;
	album?: string;
	description?: string;
	duration?: number;
	/** add suggested genre tags once the track is published */
	autoTag?: boolean;
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

async function uploadBlob(rpc: RepoRpc, file: MediaFile, assertSession: () => void) {
	const bytes = await file.arrayBuffer();
	assertSession();
	return ok(uploadRepoBlob(rpc, {
		input: bytes,
		headers: { 'content-type': file.type }
	}));
}

type ViewerLikes = { did: string; promise: Promise<Map<string, LikeRef>> };
const viewerLikes = new WeakMap<RepoRpc, ViewerLikes>();

type PdsSession = Pick<Auth<RepoRpc>, 'did' | 'rpc'>;
type CommentAttempt = { rkey: string; createdAt: string };

export function createPublicPds(auth: PdsSession, { NSID, api, createStorage, getAuth, newRkey, catalogChanged }: {
  NSID: AuthConfig['NSID'];
  api: Pick<ReturnType<typeof createApi>, 'awaitRecord' | 'track'>;
  createStorage: CreateStorage;
  getAuth: () => PdsSession;
  newRkey: () => string;
  catalogChanged: (did: string, scope: CatalogScope) => void;
}) {
	const catalogScopes: Record<string, CatalogScope> = {
		[NSID.track]: 'tracks', [NSID.list]: 'collections', [NSID.like]: 'likes', [NSID.profile]: 'profile'
	};

	function session() {
		if (!auth.rpc || !auth.did) throw new Error('sign in first');
		return { rpc: auth.rpc, did: auth.did as `did:${string}:${string}` };
	}

	function assertSession() {
		const { did, rpc } = session();
		if (getAuth().did !== did || getAuth().rpc !== rpc) throw new Error('account changed before publishing.');
	}
	function pendingCreates(kind: 'track' | 'playlist' | 'album') {
		return createStorage.load(session().did, kind === 'track' ? NSID.track : NSID.list);
	}
	async function reserveCreate(kind: 'track' | 'playlist' | 'album'): Promise<CreateReservation> {
		assertSession();
		if ((await pendingCreates(kind)).some(operation => !operation.archived)) throw new CreateUnconfirmed();
		assertSession();
		const owner = session().did, collection = kind === 'track' ? NSID.track : NSID.list, rkey = newRkey();
		return { owner, collection, rkey, uri: `at://${owner}/${collection}/${rkey}` };
	}
	async function recoverCreate(operation: CreateOperation, retry = false) {
		assertSession();
		if (operation.owner !== session().did || (operation.collection !== NSID.track && operation.collection !== NSID.list)) throw new Error('not your pending creation');
		const creator = recordCreator(session().rpc, createStorage, assertSession, NSID.list);
		const result = await (retry ? creator.retry(operation) : creator.check(operation));
		return result.state === 'accepted' ? { ...result, status: await settle(result.uri, result.cid) } : result;
	}
	async function dismissCreate(operation: CreateOperation, keepExisting = false) {
		assertSession();
		const result = await recoverCreate(operation);
		if (result.state !== 'accepted' && !(keepExisting && result.state === 'different')) throw new CreateUnconfirmed();
		await createStorage.delete(operation);
	}
	async function archiveCreate(operation: CreateOperation, archived: boolean) {
		assertSession();
		if (operation.owner !== session().did || (operation.collection !== NSID.track && operation.collection !== NSID.list)) throw new Error('not your pending creation');
		await createStorage.archive(operation, archived);
	}
	async function publishCreate(reservation: CreateReservation, record: Record<string, unknown>, draft?: { id: string; autoTag?: boolean; handedOff: () => Promise<void> }) {
		const operation = { ...reservation, record, ...(draft ? { draftId: draft.id, autoTag: draft.autoTag } : {}) };
		const result = await recordCreator(session().rpc, createStorage, assertSession, NSID.list).create(operation, draft?.handedOff);
		if (result.state !== 'accepted') throw new CreateUnconfirmed();
		return { uri: result.uri, status: await settle(result.uri, result.cid) };
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
				const scope = Object.hasOwn(catalogScopes, collection) ? catalogScopes[collection] : undefined;
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
					listRecords(rpc, {
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
		const subject = publicTrackReference(track);
		const likes = await myLikes();
		const existing = likes.get(subject.uri);
		if (existing) return waitForIndex ? settle(existing.uri, existing.cid) : 'pending';
		const res = await ok(
			createRecord(rpc, {
				input: {
					repo: did,
					collection: NSID.like as `${string}.${string}.${string}`,
					record: { $type: NSID.like, subject, createdAt: new Date().toISOString() }
				}
			})
		).catch((error: unknown) => { viewerLikes.delete(rpc); throw error; });
		likes.set(subject.uri, { uri: res.uri, cid: res.cid, rkey: ownedRkey(res.uri, did, NSID.like), subject });
		const indexed = settle(res.uri, res.cid);
		return waitForIndex ? indexed : 'pending';
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
		const indexed = settle(existing.uri);
		return waitForIndex ? indexed : 'pending';
	}

	function newCommentAttempt(): CommentAttempt {
		return { rkey: newRkey(), createdAt: new Date().toISOString() };
	}

	async function comment(track: Track, text: string, timestampMs: number, attempt: CommentAttempt) {
		assertSession();
		const { rpc, did } = session();
		const subject = publicTrackReference(track);
		const collection = NSID.comment as `${string}.${string}.${string}`;
		const params = { repo: did, collection, rkey: attempt.rkey };
		const uri = `at://${did}/${collection}/${attempt.rkey}`;
		const record = { $type: collection, subject, text, timestampMs: Math.max(0, Math.round(timestampMs)), createdAt: attempt.createdAt };
		try {
			const res = await ok(createRecord(rpc, { input: { ...params, record } }));
			if (res.uri === uri && res.cid) return { uri, cid: res.cid, rkey: attempt.rkey, subject };
		} catch {
			// A committed write can outlive its response.
		}
		assertSession();
		const existing = await getRecord(rpc, { params });
		if (existing.ok && existing.data.uri === uri && existing.data.cid && sameRecord(existing.data.value, record)) {
			return { uri, cid: existing.data.cid, rkey: attempt.rkey, subject };
		}
		throw new CreateUnconfirmed();
	}

	async function deleteComment(rkey: string, cid: string): Promise<void> {
		const { rpc, did } = session();
		await ok(rpc.post('com.atproto.repo.deleteRecord', {
			input: { repo: did, collection: NSID.comment as `${string}.${string}.${string}`, rkey, swapRecord: cid }
		}));
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
		assertSession();
		const { rpc, did } = session();
		const res = await ok(
			getRecord(rpc, { params: { repo: did, collection: LIST(), rkey: ownedRkey(uri, did, LIST()) } })
		);
		assertSession();
		const value = res.value as unknown as ListRecord;
		if (res.uri !== uri || !res.cid || value.listType !== kind) throw new Error('not an editable collection');
		return { value, cid: res.cid };
	}

	async function writeList(uri: string, value: ListRecord, swap: string): Promise<AwaitStatus> {
		assertPublicCollection({ ...value, $type: NSID.list }, NSID.list);
		assertSession();
		const { rpc, did } = session();
		const res = await ok(
			putRecord(rpc, {
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
		const items = first ? [{ subject: publicTrackReference(first) }] : [];
		const reservation = await reserveCreate('playlist');
		return publishCreate(reservation, { $type: NSID.list, name: name.trim().slice(0, 64), listType: 'playlist', items, createdAt: new Date().toISOString() });
	}

	async function addToPlaylist(playlistUri: string, track: Track): Promise<AwaitStatus> {
		const subject = publicTrackReference(track);
		const { value, cid } = await readList(playlistUri);
		if (value.items.some((i) => i.subject.uri === track.record.uri)) return 'indexed';
		if (value.items.length >= MAX_ITEMS) throw new Error(`playlists hold at most ${MAX_ITEMS} tracks`);
		value.items = [...value.items, { subject }];
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
		assertSession();
		await ok(rpc.post('com.atproto.repo.deleteRecord', { input: { repo: did, collection: LIST(), rkey, swapRecord: cid } }));
		return await settle(playlistUri);
	}

	// uploads: the audio goes to the user's PDS as a blob and the track record
	// points at it. the appview never touches the bytes; players fetch them from
	// the PDS (see identity.blobUrl).

	async function uploadTrack(input: NewTrack, reserved?: CreateReservation, draft?: { id: string; handedOff: () => Promise<void> }): Promise<{ uri: string; status: AwaitStatus }> {
		const { rpc, did } = session();
		const reservation = reserved ?? await reserveCreate('track');
		if (reservation.owner !== did || reservation.collection !== NSID.track || reservation.uri !== `at://${did}/${NSID.track}/${reservation.rkey}`) throw new Error('not your upload reservation');
		assertSession();
		if (!input.file.type.startsWith('audio/')) throw new Error('pick an audio file');
		if (input.file.size > MAX_AUDIO_BYTES) throw new Error('audio files are limited to 100 MB');
		const uploaded = await uploadBlob(rpc, input.file, assertSession);
		assertSession();
		const record = await prepareTrackRecord(input);
		assertSession();
		return publishCreate(reservation, { ...record, audioBlob: uploaded.blob }, draft && { ...draft, autoTag: input.autoTag });
	}

	async function prepareTrackRecord(input: NewTrack) {
		assertSession();
		const tags = input.tags === undefined ? undefined : normalizeTrackTags(input.tags);
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
		assertSession();

		return record;
	}

	function uploadedIntent(operation: CreateOperation, audioUrl: string) {
		assertSession();
		if (operation.owner !== session().did || operation.collection !== NSID.track) throw new Error('not your upload reservation.');
		const url = new URL(audioUrl);
		if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid uploaded audio address.');
		if (operation.uri !== `at://${operation.owner}/${operation.collection}/${operation.rkey}`) throw new Error('invalid upload reservation.');
		assertPublicUploadRecord(operation.record);
		return { ...operation, record: { ...operation.record, audioUrl, downloadPolicy: 'open' } };
	}

	async function archiveUploadedTrack(operation: CreateOperation, audioUrl: string) {
		const ready = uploadedIntent(operation, audioUrl);
		await createStorage.put(ready);
		assertSession();
		await createStorage.archive(ready, true);
	}

	async function uploadedTrack(operation: CreateOperation, audioUrl: string, publish = false) {
		const ready = uploadedIntent(operation, audioUrl);
		const creator = recordCreator(session().rpc, createStorage, assertSession, NSID.list);
		if (!publish) return creator.check(ready);
		const previous = (await pendingCreates('track')).find(item => item.rkey === operation.rkey);
		assertSession();
		if (previous && !sameRecord(previous.record, ready.record)) throw new Error('publication differs from the saved creation attempt.');
		if (previous) return creator.retry(previous);
		const found = await creator.check(ready);
		return found.state === 'missing' ? creator.create(ready) : found;
	}

	// the plyr profile is one fm.plyr.*.actor.profile/self record. unknown fields
	// written by other clients are kept; swapRecord guards concurrent edits.

	const PROFILE = () => NSID.profile as Nsid;

	async function myProfile(): Promise<{ value: ProfileRecord | null; cid: string | null }> {
		const { rpc, did } = session();
		const res = await getRecord(rpc, {
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
		assertSession();
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
			putRecord(rpc, {
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

	/**
	 * upload cover art as a blob and return the record fields: imageBlob is the
	 * canonical cover; imageUrl is its getBlob url for clients that only read urls.
	 */
	async function uploadCover(file: MediaFile) {
		const { rpc } = session();
		assertSession();
		if (!(ARTWORK_TYPES as readonly string[]).includes(file.type)) throw new Error('choose a PNG, JPEG, WebP, or GIF cover');
		if (file.size > MAX_ARTWORK_BYTES) throw new Error('cover art is limited to 10 MB');
		const uploaded = await uploadBlob(rpc, file, assertSession);
		assertSession();
		return { imageBlob: uploaded.blob };
	}

	async function uploadArtwork(file: MediaFile): Promise<{ imageBlob: unknown; imageUrl: string }> {
		const { did } = session();
		const { imageBlob } = await uploadCover(file);
		const cid = (imageBlob as { ref: { $link: string } }).ref.$link;
		return { imageBlob, imageUrl: await blobUrl(did, cid) };
	}

	const { myTrack, editTrack, deleteTrack } = trackEditor({ session, assertSession, ownedRkey, uploadArtwork, settle, trackCollection: NSID.track as Nsid, readPublicTrack: api.track });
	function collectionOrder(kind: 'album' | 'playlist' = 'playlist') {
		return collectionOrdering({ ...session(), collection: LIST(), kind, assertSession, settle });
	}
	function albumOrganization() {
		return albumPublishing({ ...session(), trackCollection: NSID.track as Nsid, assertSession, ordering: collectionOrder('album'), uploadCover,
			publish: async (name, items, cover) => publishCreate(await reserveCreate('album'), {
				$type: NSID.list, name, listType: 'album', items, ...cover, createdAt: new Date().toISOString(),
			}),
		});
	}
	return { albumOrganization, collectionOrder, myLikes, like, unlike, newCommentAttempt, comment, deleteComment, createPlaylist, addToPlaylist, removeFromPlaylist, renameCollection, deletePlaylist, uploadTrack, myProfile, saveProfile, myTrack, editTrack, deleteTrack, reserveCreate, pendingCreates, recoverCreate, dismissCreate, archiveCreate, prepareTrackRecord, uploadedTrack, archiveUploadedTrack };
}
