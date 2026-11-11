import { P256Keypair } from '@atproto/crypto';
import type { Auth } from './auth-state';
import { resolveGatedAudio, type GatedAudioSource } from './gated-audio-shared';
import { privateAudioUrl, releasePrivateAudio } from './private-audio.web';

export async function gatedAudioUrl(uri: string, auth: Auth): Promise<string> {
	const source = await resolveGatedAudio(uri, auth, {
		fetch: (url, init) => fetch(url, init),
		keypair: () => P256Keypair.create()
	});
	try { return await privateAudioUrl(source); }
	catch {
		console.info('[playback] protected streaming unavailable; using buffered playback');
		return bufferedAudio(source);
	}
}

async function bufferedAudio(source: GatedAudioSource): Promise<string> {
	const response = await fetch(source.url, { headers: await source.headers(), redirect: 'error', cache: 'no-store' });
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
		return URL.createObjectURL(new Blob(chunks, { type: source.mimeType }));
	} finally { await reader.cancel().catch(() => undefined); }
}

export function releaseGatedAudioUrl(uri: string) {
	if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
	else releasePrivateAudio(uri);
}
