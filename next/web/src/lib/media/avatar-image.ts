import { MAX_AVATAR_BYTES } from '@plyr/next-core/profile-record';
import { coverImage } from './cover-image';

const AVATAR_EDGE = 1000;

function encode(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

/** a square png or jpeg avatar under the 1 MB profile limit. */
export async function avatarImage(file: File): Promise<File> {
  const readable = await coverImage(file, AVATAR_EDGE * 2);
  const address = URL.createObjectURL(readable);
  try {
    const image = new Image();
    image.src = address;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const edge = Math.min(side, AVATAR_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = edge;
    const context = canvas.getContext('2d');
    if (!context || !edge) throw new Error('could not open this image. choose a different photo.');
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, edge, edge);
    const name = file.name.replace(/\.[^.]*$/, '') || 'avatar';
    if (readable.type === 'image/png') {
      const png = await encode(canvas, 'image/png');
      if (png && png.size <= MAX_AVATAR_BYTES) return new File([png], `${name}.png`, { type: 'image/png' });
    }
    for (const quality of [0.9, 0.8, 0.65]) {
      const jpeg = await encode(canvas, 'image/jpeg', quality);
      if (jpeg && jpeg.size <= MAX_AVATAR_BYTES) return new File([jpeg], `${name}.jpg`, { type: 'image/jpeg' });
    }
    throw new Error('that image is too large. choose a smaller one.');
  } finally {
    URL.revokeObjectURL(address);
  }
}
