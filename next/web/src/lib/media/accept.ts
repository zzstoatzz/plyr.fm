const AUDIO = 'audio/*,.aif,.aiff,.m4a,.mp3,.aac,.ogg,.opus,.wav,.flac';

/**
 * What an audio picker accepts. Apple and Android type WebM (even audio/webm) as
 * video, and any video type makes a phone's picker offer the camera, so touch
 * screens leave WebM out.
 */
export function audioAccept(): string {
	const touch = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;
	return touch ? AUDIO : `${AUDIO},.webm`;
}
