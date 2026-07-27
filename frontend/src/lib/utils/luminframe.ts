/**
 * pick images from the user's own `com.luminframe.image` records as cover art.
 *
 * luminframe (https://luminframe.com) is an atproto image editor that saves
 * finished edits to the author's repo. those records aren't indexed by any
 * appview we can query, so we resolve the DID to its PDS and read the
 * collection directly — same pattern as `utils/atprotofans.ts`. records and
 * blobs are public, so no auth or extra OAuth scope is needed.
 */

export const LUMINFRAME_COLLECTION = 'com.luminframe.image';

export interface LuminframeImage {
	/** at:// URI of the source record. */
	uri: string;
	/** public getBlob URL for the rendered image. */
	imageUrl: string;
	/** blob mime type as recorded on the PDS, e.g. "image/png". */
	mimeType: string;
	title?: string;
	alt?: string;
	createdAt: string;
	aspectRatio: { width: number; height: number };
}

interface DidDocService {
	id: string;
	serviceEndpoint?: string;
}

/** resolve a DID to its atproto PDS endpoint (did:plc and did:web), or null. */
export async function resolvePdsEndpoint(did: string): Promise<string | null> {
	let docUrl: string;
	if (did.startsWith('did:plc:')) {
		docUrl = `https://plc.directory/${did}`;
	} else if (did.startsWith('did:web:')) {
		const host = did.slice('did:web:'.length).split(':')[0];
		docUrl = `https://${host}/.well-known/did.json`;
	} else {
		return null;
	}
	try {
		const didDoc = await fetch(docUrl).then((r) => r.json());
		const services: DidDocService[] = didDoc?.service ?? [];
		return services.find((s) => s.id.endsWith('atproto_pds'))?.serviceEndpoint ?? null;
	} catch {
		return null;
	}
}

interface RawBlobRef {
	ref?: { $link?: string };
	mimeType?: string;
}

interface RawLuminframeRecord {
	uri: string;
	value?: {
		image?: RawBlobRef;
		title?: string;
		alt?: string;
		createdAt?: string;
		aspectRatio?: { width?: number; height?: number };
	};
}

/** shape one listRecords entry into a picker item, or null if it has no image blob. */
export function recordToImage(
	record: RawLuminframeRecord,
	did: string,
	pds: string
): LuminframeImage | null {
	const blobCid = record.value?.image?.ref?.$link;
	if (!blobCid) return null;
	const params = new URLSearchParams({ did, cid: blobCid });
	return {
		uri: record.uri,
		imageUrl: `${pds}/xrpc/com.atproto.sync.getBlob?${params}`,
		mimeType: record.value?.image?.mimeType ?? 'image/png',
		title: record.value?.title,
		alt: record.value?.alt,
		createdAt: record.value?.createdAt ?? '',
		aspectRatio: {
			width: record.value?.aspectRatio?.width ?? 1,
			height: record.value?.aspectRatio?.height ?? 1
		}
	};
}

/** how many records to request per listRecords page. */
const PAGE_SIZE = 100;
/** stop paginating after this many records — a picker, not an archive browser. */
const MAX_RECORDS = 300;

/**
 * list the user's luminframe images, newest first (listRecords returns
 * reverse rkey order and rkeys are TIDs). returns [] when the collection
 * is empty or the PDS can't be resolved.
 */
export async function listLuminframeImages(did: string): Promise<LuminframeImage[]> {
	const pds = await resolvePdsEndpoint(did);
	if (!pds) return [];

	const images: LuminframeImage[] = [];
	let cursor: string | undefined;
	while (images.length < MAX_RECORDS) {
		const params = new URLSearchParams({
			repo: did,
			collection: LUMINFRAME_COLLECTION,
			limit: String(PAGE_SIZE)
		});
		if (cursor) params.set('cursor', cursor);
		const response = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
		if (!response.ok) break;
		const data: { records?: RawLuminframeRecord[]; cursor?: string } = await response.json();
		for (const record of data.records ?? []) {
			const image = recordToImage(record, did, pds);
			if (image) images.push(image);
		}
		cursor = data.cursor;
		if (!cursor || (data.records ?? []).length < PAGE_SIZE) break;
	}
	return images;
}

const EXTENSION_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

/**
 * download a luminframe image blob and wrap it as a File, so it can travel
 * the exact same path as artwork chosen from disk (validation, R2 storage,
 * thumbnails, and moderation all apply unchanged).
 */
export async function fetchLuminframeImageAsFile(image: LuminframeImage): Promise<File> {
	const response = await fetch(image.imageUrl);
	if (!response.ok) {
		throw new Error(`failed to fetch image from your PDS (${response.status})`);
	}
	const blob = await response.blob();
	// prefer the mime type the PDS actually served; fall back to the record's
	const mimeType = blob.type?.startsWith('image/') ? blob.type : image.mimeType;
	const ext = EXTENSION_BY_MIME[mimeType] ?? 'png';
	const rkey = image.uri.split('/').pop() ?? 'image';
	return new File([blob], `luminframe-${rkey}.${ext}`, {
		type: mimeType in EXTENSION_BY_MIME ? mimeType : 'image/png'
	});
}
