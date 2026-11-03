import { P256Keypair } from '@atproto/crypto';
import type { Auth } from './auth-state';
import { openGatedAudio } from './gated-audio-shared';

export async function gatedAudioUrl(uri: string, auth: Auth): Promise<string> {
	const response = await openGatedAudio(uri, auth, {
		fetch: (url, init) => fetch(url, init),
		keypair: () => P256Keypair.create()
	});
	return URL.createObjectURL(await response.blob());
}

export function releaseGatedAudioUrl(uri: string) {
	if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
