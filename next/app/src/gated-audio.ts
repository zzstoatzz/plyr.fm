import { P256Keypair } from '@atproto/crypto';
import { getRandomBytesAsync, randomUUID } from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import type { Auth } from './auth-state';
import { AUDIO_CONTAINERS, containerFromContentType, sniffAudio } from '@plyr/next-core/audio-format';
import { openGatedAudio } from './gated-audio-shared';
import { MAX_AUDIO_BYTES } from './pds';

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
	// Gather enough of the head to see the container's signature, even if the first chunks are tiny.
	let head = new Uint8Array(0);
	for (let chunk = await reader.read(); ; chunk = await reader.read()) {
		if (!chunk.done) {
			const joined = new Uint8Array(head.byteLength + chunk.value.byteLength);
			joined.set(head);
			joined.set(chunk.value, head.byteLength);
			head = joined;
		}
		if (chunk.done || head.byteLength >= 16) break;
	}
	if (!head.byteLength) {
		await reader.cancel().catch(() => undefined);
		throw new Error('this track has no audio');
	}
	const first: ReadableStreamReadResult<Uint8Array> = { done: false, value: head };
	// AVPlayer picks its decoder from the file extension, and a PDS may serve the blob as octet-stream.
	const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
	const container = sniffAudio(first.value)?.container ?? containerFromContentType(type);
	const extension = container ? AUDIO_CONTAINERS[container].fileType : 'mp3';
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
