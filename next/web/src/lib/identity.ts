// did document lookups for things the read-only appview leaves to clients
// (e.g. where a repo's blobs live). cached per did for the page lifetime.

interface DidDocument {
	alsoKnownAs?: string[];
	service?: { id: string; type: string; serviceEndpoint: string }[];
}

const docs = new Map<string, Promise<DidDocument>>();

export function didDocument(did: string): Promise<DidDocument> {
	let doc = docs.get(did);
	if (!doc) {
		const url = did.startsWith('did:plc:')
			? `https://plc.directory/${did}`
			: did.startsWith('did:web:')
				? `https://${did.slice('did:web:'.length)}/.well-known/did.json`
				: null;
		if (!url) return Promise.reject(new Error(`unsupported did method: ${did}`));
		doc = fetch(url).then((r) => {
			if (!r.ok) throw new Error(`did document ${r.status}`);
			return r.json() as Promise<DidDocument>;
		});
		doc.catch(() => docs.delete(did));
		docs.set(did, doc);
	}
	return doc;
}

export async function pdsEndpoint(did: string): Promise<string> {
	const doc = await didDocument(did);
	const pds = doc.service?.find((s) => s.id.endsWith('#atproto_pds'))?.serviceEndpoint;
	if (!pds) throw new Error('no PDS in did document');
	return pds.replace(/\/$/, '');
}

/** a blob is fetched from the repo's own PDS; nothing proxies it. */
export async function blobUrl(did: string, cid: string): Promise<string> {
	const params = new URLSearchParams({ did, cid });
	return `${await pdsEndpoint(did)}/xrpc/com.atproto.sync.getBlob?${params}`;
}

/** does this PDS advertise spaces (gated audio)? */
export async function pdsSupportsSpaces(pds: string): Promise<boolean> {
	try {
		const res = await fetch(`${pds}/xrpc/com.atproto.server.describeServer`);
		if (!res.ok) return false;
		return (await res.json())?.spacesAlpha === true;
	} catch {
		return false;
	}
}
