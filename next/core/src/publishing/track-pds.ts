import { RepoResponseError, repoOk as ok, getRecord, putRecord, uploadRepoBlob, type RepoRpc } from './repo-rpc';
import type { Did } from '../auth-state';
import { trackIdFromUri, type AwaitStatus, type createApi } from '../api';
import { isOpen } from '../access/policy';
import type { MediaFile } from './private-music';
import { normalizeTrackTags } from './track-tags';
import { sameRecord } from './create-operation';
import { replacedTrackAudio, validateReplacementAudio, TrackWriteUnconfirmed } from './track-audio';

export class TrackRevisionConflict extends Error {
  constructor() { super('this track changed elsewhere. reload the latest version before saving.'); }
}

export interface TrackEdits {
	audio?: { file: MediaFile; duration?: number };
	tags?: string[];
	title: string;
	album: string;
	description: string;
	/** a new cover (File), remove it (null), or keep it (undefined) */
	artwork?: MediaFile | null;
}

export function trackEditor({ session, assertSession, ownedRkey, uploadArtwork, settle, trackCollection, readPublicTrack }: {
  session: () => { rpc: RepoRpc; did: Did };
  assertSession: () => void;
  trackCollection: `${string}.${string}.${string}`;
  readPublicTrack: ReturnType<typeof createApi>['track'];
  ownedRkey: (uri: string, did: string, collection: string) => string;
  uploadArtwork: (file: MediaFile) => Promise<{ imageBlob: unknown; imageUrl: string }>;
  settle: (uri: string, cid?: string) => Promise<AwaitStatus>;
}) {
  async function requireOpenAudio(uri: string) {
    assertSession();
    const track = await readPublicTrack(trackIdFromUri(uri), { fresh: true });
    assertSession();
    if (track.record.uri !== uri || track.artist.did !== session().did || !isOpen(track)) {
      throw new Error('replace protected or restricted audio in the current app.');
    }
  }
	async function editTrack(uri: string, edits: TrackEdits, revision?: Awaited<ReturnType<typeof myTrack>>): Promise<AwaitStatus> {
		assertSession();
		const { rpc, did } = session();
		const rkey = ownedRkey(uri, did, trackCollection);
		const tags = edits.tags === undefined ? undefined : normalizeTrackTags(edits.tags);
		const current = revision ?? await readTrack(uri, rkey);
		if (current.uri !== uri) throw new Error('track revision does not match');
		assertSession();
		let record = { ...(current.value as Record<string, unknown>) };
		if (edits.audio) validateReplacementAudio(record, edits.audio.file);
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
		if (edits.audio) {
			await requireOpenAudio(uri);
			const bytes = await edits.audio.file.arrayBuffer();
			assertSession();
			if (bytes.byteLength !== edits.audio.file.size) throw new Error('the selected audio changed. choose it again.');
			const uploaded = await ok(uploadRepoBlob(rpc, { input: bytes, headers: { 'content-type': edits.audio.file.type } }));
			assertSession();
			record = replacedTrackAudio(record, edits.audio.file, uploaded.blob, edits.audio.duration);
			await requireOpenAudio(uri);
		}
		assertSession();
		const res = await ok(
			putRecord(rpc, {
				input: {
					repo: did,
					collection: trackCollection,
					rkey,
					record,
					swapRecord: current.cid
				}
			})
		).then(result => {
			assertSession();
			if (result.uri !== uri || !result.cid) throw new TrackWriteUnconfirmed();
			return result;
		}).catch(async (error: unknown) => {
			assertSession();
			if (edits.audio) {
				let latest: Awaited<ReturnType<typeof readTrack>>;
				try { latest = await readTrack(uri, rkey); }
				catch { assertSession(); throw new TrackWriteUnconfirmed(); }
				if (sameRecord(latest.value, record)) return { uri: latest.uri, cid: latest.cid };
				if (latest.cid !== current.cid) throw new TrackRevisionConflict();
			}
			if (error instanceof RepoResponseError && error.error === 'InvalidSwap') throw new TrackRevisionConflict();
			throw error;
		});
		return await settle(res.uri, res.cid);
	}

	async function readTrack(uri: string, rkey: string) {
		assertSession();
		const { rpc, did } = session();
		const result = await ok(
			getRecord(rpc, { params: { repo: did, collection: trackCollection, rkey } })
		);
		assertSession();
		if (result.uri !== uri || !result.cid) throw new Error('could not read your track revision');
		return { ...result, cid: result.cid };
	}

	async function myTrack(uri: string) {
		const { did } = session();
		return readTrack(uri, ownedRkey(uri, did, trackCollection));
	}

	async function deleteTrack(uri: string): Promise<AwaitStatus> {
		const { rpc, did } = session();
		const rkey = ownedRkey(uri, did, trackCollection);
		const { cid } = await readTrack(uri, rkey);
		assertSession();
		await ok(
			rpc.post('com.atproto.repo.deleteRecord', {
				input: { repo: did, collection: trackCollection, rkey, swapRecord: cid }
			})
		);
		return await settle(uri);
	}
  return { myTrack, editTrack, deleteTrack };
}
