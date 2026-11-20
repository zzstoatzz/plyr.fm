import { P256Keypair } from '@atproto/crypto';
import { getRandomBytesAsync, randomUUID } from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import type { Auth } from './auth-state';
import { sniffAudioExtension } from '@plyr/next-core/audio-sniff';
import { openGatedAudio } from './gated-audio-shared';
import { MAX_AUDIO_BYTES } from './pds';

const EXTENSIONS: Record<string, string> = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/mp4': 'm4a',
	'audio/aac': 'aac',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/flac': 'flac',
	'audio/ogg': 'ogg',
	'audio/x-m4a': 'm4a',
	'audio/m4a': 'm4a',
	'audio/aiff': 'aiff',
	'audio/x-aiff': 'aiff',
	'audio/wave': 'wav',
	'audio/vnd.wave': 'wav',
	'audio/x-flac': 'flac',
	'audio/webm': 'webm',
	'video/mp4': 'm4a'
};

const active = new Map<string, File>();
let cache: Directory | undefined;

function audioCache(): Directory {
	if (cache) return cache;
	const directory = new Directory(Paths.cache, 'plyr-private-audio');
	if (directory.exists) directory.delete();
	directory.create();
	cache = directory;
	return directory;
}

function removeFile(file: File) {
	try {
		if (file.exists) file.delete();
	} catch {
		// A busy file can be cleared when the cache is opened next time.
	}
}

export async function gatedAudioUrl(uri: string, auth: Auth): Promise<string> {
	const response = await openGatedAudio(uri, auth, {
		fetch: (url, init) => fetch(url, init),
		keypair: async () => P256Keypair.import(await getRandomBytesAsync(32))
	});
	if (!response.body) throw new Error('this track has no audio');
	const reader = response.body.getReader();
	const first = await reader.read();
	if (first.done || !first.value.byteLength) {
		await reader.cancel().catch(() => undefined);
		throw new Error('this track has no audio');
	}
	// AVPlayer picks its decoder from the file extension, and a PDS may serve the blob as octet-stream.
	const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
	const extension = sniffAudioExtension(first.value) ?? EXTENSIONS[type] ?? 'mp3';
	const file = new File(audioCache(), `${randomUUID()}.${extension}`);

	try {
		file.create();
		const handle = file.open(FileMode.WriteOnly);
		try {
			let bytes = 0;
			for (let chunk: ReadableStreamReadResult<Uint8Array> = first; ; chunk = await reader.read()) {
				const { done, value } = chunk;
				if (done) break;
				bytes += value.byteLength;
				if (bytes > MAX_AUDIO_BYTES) throw new Error('this protected track exceeds the 100 MB limit');
				await handle.writeBytes(value);
			}
			if (!bytes) throw new Error('this track has no audio');
		} finally {
			handle.close();
		}
		active.set(file.uri, file);
		return file.uri;
	} catch (error) {
		removeFile(file);
		throw error;
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

export function releaseGatedAudioUrl(uri: string) {
	const file = active.get(uri);
	if (!file) return;
	active.delete(uri);
	removeFile(file);
}
