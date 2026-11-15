import { P256Keypair } from '@atproto/crypto';
import { isCid, isLexMap, type LexMap } from '@atproto/lex-data';
import { lexParse } from '@atproto/lex-json';
import { createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken, RECORD_MAC_PROFILE, verifyRecord } from '@atproto/space';
import { isSpaceAtUriString } from '@atproto/syntax';
import { createGatedAudio, type GatedAudioSource } from '@plyr/next-core/gated-audio';
import { auth } from '$lib/auth';
import { privateAudioUrl, releasePrivateAudio } from './private-audio';

const { resolveGatedAudio } = createGatedAudio<P256Keypair, LexMap>({
	isSpaceAtUriString, createSpaceSigHeaders, encapsulate, formatMacRequest, parseSpaceToken,
	RECORD_MAC_PROFILE, verifyRecord, isCid, isLexMap, lexParse
});

export interface AudioSource {
	url: string;
	release?(): void;
}

export async function protectedAudio(uri: string, signal: AbortSignal): Promise<AudioSource> {
	const account = auth.getAuth();
	const guard = () => {
		signal.throwIfAborted();
		if (auth.getAuth().agent !== account.agent) throw new Error('account changed. try again.');
	};
	const source = await resolveGatedAudio(uri, account, {
		guard,
		fetch: (url, init) => {
			// An in-flight credential can be shared by two tracks in the same Space.
			return new URL(url).pathname === '/xrpc/com.atproto.space.getSpaceCredential'
				? fetch(url, init)
				: fetch(url, { ...init, signal, cache: 'no-store' });
		},
		keypair: () => P256Keypair.create()
	});
	const guarded = {
		...source,
		async headers() {
			guard();
			const headers = await source.headers();
			guard();
			return headers;
		}
	};
	let next: AudioSource;
	try {
		const url = await privateAudioUrl(guarded);
		next = { url, release: () => releasePrivateAudio(url) };
	} catch {
		guard();
		next = await bufferedAudio(guarded, signal);
	}
	try {
		guard();
		return next;
	} catch (error) {
		next.release?.();
		throw error;
	}
}

async function bufferedAudio(source: GatedAudioSource, signal: AbortSignal): Promise<AudioSource> {
	const response = await fetch(source.url, { headers: await source.headers(), redirect: 'error', cache: 'no-store', signal });
	if (!response.ok || !response.body) throw new Error('could not load this protected audio');
	const reader = response.body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > source.size) throw new Error('invalid protected audio length');
			chunks.push(value);
		}
		if (bytes !== source.size) throw new Error('incomplete protected audio');
		const url = URL.createObjectURL(new Blob(chunks, { type: source.mimeType }));
		return { url, release: () => URL.revokeObjectURL(url) };
	} finally { await reader.cancel().catch(() => undefined); }
}
