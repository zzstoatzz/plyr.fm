/**
 * resize images at the CDN edge for display.
 *
 * artists upload full-resolution artwork (multi-MB originals) and the app used
 * to serve those bytes for every render — a 5MB jpeg for a 56px footer tile.
 * our image hosts sit behind a CDN that can transform on the fly via a URL
 * prefix, so this helper rewrites an image URL to request a display-sized,
 * modern-format rendition instead of the original.
 *
 * the CDN specifics live entirely in this module: callers just say how wide
 * the image renders. URLs on hosts we don't control (external avatars, legacy
 * r2.dev links) pass through unchanged, as does anything already transformed.
 * pass the *original* URL to moderation checks (`SensitiveImage src`) — only
 * the `<img src>` should be resized.
 */

/** hosts served from a zone with edge image transformations enabled. */
const RESIZABLE_HOSTS = new Set(['images.plyr.fm', 'images-stg.plyr.fm']);

const TRANSFORM_PREFIX = '/cdn-cgi/image/';

/** widths for common artwork slots (device-pixel headroom included). */
export const IMAGE_WIDTHS = {
	thumb: 96,
	tile: 320,
	hero: 640
} as const;

export function resizedImageUrl(
	url: string | null | undefined,
	width: number
): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (
			!RESIZABLE_HOSTS.has(parsed.hostname) ||
			parsed.pathname.startsWith(TRANSFORM_PREFIX)
		) {
			return url;
		}
		return `${parsed.origin}${TRANSFORM_PREFIX}width=${width},quality=82,format=auto${parsed.pathname}`;
	} catch {
		return url;
	}
}
