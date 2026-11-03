// cover art goes to the user's PDS as a blob (fm.plyr.track#imageBlob). we
// shrink big images first, like social-app does before uploading media.

export const MAX_ART_BYTES = 10_000_000; // lexicon imageBlob.maxSize
const MAX_EDGE = 2000;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** square-ish cover, ≤ 2000px on the long edge, jpeg if it had to be re-encoded. */
export async function prepareArtwork(file: File): Promise<Blob> {
	if (!ACCEPT.includes(file.type)) throw new Error('cover art has to be png, jpeg, webp or gif');
	// gifs keep their animation; everything small enough goes up untouched
	if (file.type === 'image/gif' || file.size <= 1_500_000) {
		if (file.size > MAX_ART_BYTES) throw new Error('cover art is limited to 10 MB');
		return file;
	}
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
	if (!out) throw new Error("couldn't read that image");
	if (out.size > MAX_ART_BYTES) throw new Error('cover art is limited to 10 MB');
	return out;
}
