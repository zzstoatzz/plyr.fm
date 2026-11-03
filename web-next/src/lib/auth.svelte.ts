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
import { SCOPE_PARTS, SITE_URL, TYPEAHEAD_URL } from './config';

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
			scope: SCOPE
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
		this.agent = this.rpc = null;
	}

	#use(session: Awaited<ReturnType<typeof getSession>>) {
		this.agent = new OAuthUserAgent(session);
		this.rpc = new Client({ handler: this.agent });
		this.did = session.info.sub;
		this.handle = this.displayName = this.avatar = null;
		const did = session.info.sub;
		viewerProfile(did).then((p) => {
			if (this.did !== did) return;
			this.handle = p.handle;
			this.displayName = p.displayName;
			this.avatar = p.avatar;
		});
	}
}

export const auth = new Auth();

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
