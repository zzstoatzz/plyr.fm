// browser-side atproto oauth. the appview never sees a session: the browser
// holds the DPoP-bound tokens and talks to the user's PDS directly.
import { Client } from '@atcute/client';
import {
	CompositeDidDocumentResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	XrpcHandleResolver
} from '@atcute/identity-resolver';
import {
	OAuthUserAgent,
	configureOAuth,
	createAuthorizationUrl,
	deleteStoredSession,
	finalizeAuthorization,
	getSession
} from '@atcute/oauth-browser-client';
import { BASE_SCOPE_PARTS, NSID, SCOPE_PARTS, SITE_URL, TYPEAHEAD_URL } from './config';
import { pdsEndpoint, pdsSupportsSpaces } from './identity';

const ACTIVE_KEY = 'plyr-next:active-did';

export const SCOPE = SCOPE_PARTS.join(' ');

let configured = false;

function configure() {
	if (configured) return;
	configured = true;
	const loopback = location.hostname === '127.0.0.1';
	const origin = loopback ? location.origin : SITE_URL;
	// loopback dev uses the spec's virtual client id; production serves
	// static/oauth-client-metadata.json at its own client_id url.
	const redirect_uri = `${origin}/oauth/callback`;
	const client_id = loopback
		? `http://localhost?redirect_uri=${encodeURIComponent(redirect_uri)}&scope=${encodeURIComponent(SCOPE)}`
		: `${origin}/oauth-client-metadata.json`;
	configureOAuth({
		metadata: { client_id, redirect_uri },
		identityResolver: new LocalActorResolver({
			handleResolver: new XrpcHandleResolver({ serviceUrl: 'https://public.api.bsky.app' }),
			didDocumentResolver: new CompositeDidDocumentResolver({
				methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() }
			})
		})
	});
}

class Auth {
	did = $state<string | null>(null);
	handle = $state<string | null>(null);
	displayName = $state<string | null>(null);
	avatar = $state<string | null>(null);
	/** the session can use spaces (gated audio) */
	spaces = $state(false);
	ready = $state(false);
	agent: OAuthUserAgent | null = null;
	rpc: Client | null = null;

	async restore() {
		configure();
		const did = localStorage.getItem(ACTIVE_KEY);
		if (did) {
			try {
				const session = await getSession(did as `did:${string}:${string}`, { allowStale: true });
				this.#use(session);
			} catch {
				localStorage.removeItem(ACTIVE_KEY);
			}
		}
		this.ready = true;
	}

	async login(identifier: string) {
		configure();
		const url = await createAuthorizationUrl({
			target: { type: 'account', identifier: identifier as `${string}.${string}` },
			scope: await scopeFor(identifier)
		});
		await new Promise((r) => setTimeout(r, 200));
		location.assign(url);
	}

	async finish(params: URLSearchParams) {
		configure();
		const { session } = await finalizeAuthorization(params);
		this.#use(session);
		localStorage.setItem(ACTIVE_KEY, session.info.sub);
	}

	async logout() {
		const did = this.did;
		if (!did) return;
		try {
			await this.agent?.signOut();
		} catch {
			deleteStoredSession(did as `did:${string}:${string}`);
		}
		localStorage.removeItem(ACTIVE_KEY);
		this.did = this.handle = this.displayName = this.avatar = null;
		this.spaces = false;
		this.agent = this.rpc = null;
	}

	#use(session: Awaited<ReturnType<typeof getSession>>) {
		this.agent = new OAuthUserAgent(session);
		this.rpc = new Client({ handler: this.agent });
		this.did = session.info.sub;
		this.spaces = session.token.scope.split(' ').some((s) => s.startsWith('space:'));
		this.handle = this.displayName = this.avatar = null;
		const did = session.info.sub;
		const rpc = this.rpc;
		Promise.all([viewerProfile(did), plyrProfile(rpc, did)]).then(([p, own]) => {
			if (this.did !== did) return;
			this.handle = p.handle;
			this.displayName = own?.displayName ?? p.displayName;
			this.avatar = p.avatar;
		});
	}

	/** apply a just-saved plyr profile name without waiting on a reload. */
	setDisplayName(name: string | null) {
		this.displayName = name;
	}
}

export const auth = new Auth();

/** ask for space scopes only where the PDS can grant them; others reject the whole request. */
async function scopeFor(identifier: string): Promise<string> {
	try {
		const did = identifier.startsWith('did:') ? identifier : await resolveHandle(identifier);
		if (did && (await pdsSupportsSpaces(await pdsEndpoint(did)))) return SCOPE_PARTS.join(' ');
	} catch {
		/* fall back to the base scope */
	}
	return BASE_SCOPE_PARTS.join(' ');
}

async function resolveHandle(handle: string): Promise<string | null> {
	const res = await fetch(
		`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle.replace(/^@/, ''))}`
	);
	if (!res.ok) return null;
	const did = (await res.json())?.did;
	return typeof did === 'string' ? did : null;
}

type ViewerProfile = { handle: string | null; displayName: string | null; avatar: string | null };

// the viewer's own name and avatar come from typeahead (bsky profile, kept fresh
// off the firehose), so there's no appview round trip and no client setting.
async function viewerProfile(did: string): Promise<ViewerProfile> {
	try {
		const res = await fetch(`${TYPEAHEAD_URL}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
		if (res.ok) {
			const p = await res.json();
			if (p?.did === did) {
				const handle = typeof p.handle === 'string' && p.handle !== 'handle.invalid' ? p.handle : null;
				return {
					handle,
					displayName: typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName.trim() : null,
					avatar: typeof p.avatar === 'string' && p.avatar.startsWith('https://') ? p.avatar : null
				};
			}
		}
	} catch {
		/* typeahead unreachable or rate limited: fall back to the did document */
	}
	return { handle: await handleFromDidDocument(did), displayName: null, avatar: null };
}

// a displayName on the viewer's own plyr profile record wins over bsky's.
async function plyrProfile(rpc: Client, did: string): Promise<{ displayName: string | null } | null> {
	try {
		const res = await rpc.get('com.atproto.repo.getRecord', {
			params: { repo: did as `did:${string}:${string}`, collection: NSID.profile as `${string}.${string}.${string}`, rkey: 'self' }
		});
		if (!res.ok) return null;
		const name = (res.data.value as { displayName?: unknown }).displayName;
		return { displayName: typeof name === 'string' && name.trim() ? name.trim() : null };
	} catch {
		return null;
	}
}

async function handleFromDidDocument(did: string): Promise<string | null> {
	try {
		const doc = did.startsWith('did:plc:')
			? await (await fetch(`https://plc.directory/${did}`)).json()
			: await (await fetch(`https://${did.slice('did:web:'.length)}/.well-known/did.json`)).json();
		const aka: string | undefined = doc?.alsoKnownAs?.find((a: string) => a.startsWith('at://'));
		return aka ? aka.slice('at://'.length) : null;
	} catch {
		return null;
	}
}
