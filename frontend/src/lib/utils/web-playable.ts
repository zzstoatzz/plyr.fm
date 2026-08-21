/**
 * Formats browsers play natively, with no transcode step.
 *
 * Private media is stored as a PDS blob exactly as uploaded — the transcoder
 * never touches a permissioned space — so only these formats can be private.
 * Mirrors the backend's `AudioFormat.is_web_playable` (aiff/aif need
 * conversion, and so do the webm/ogg containers MediaRecorder produces).
 */
export const WEB_PLAYABLE_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac'] as const;

/** whether a bare extension (with or without a dot) is web-playable. */
export function isWebPlayableExtension(extension: string): boolean {
	const bare = extension.replace(/^\./, '').toLowerCase();
	return (WEB_PLAYABLE_EXTENSIONS as readonly string[]).includes(bare);
}

/** whether a filename's extension is web-playable. */
export function isWebPlayableAudioFile(name: string): boolean {
	const dotIndex = name.lastIndexOf('.');
	if (dotIndex === -1) return false;
	return isWebPlayableExtension(name.slice(dotIndex));
}
