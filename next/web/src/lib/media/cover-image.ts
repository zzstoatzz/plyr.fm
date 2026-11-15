import { artworkName, artworkPlan, artworkType, MAX_ARTWORK_BYTES, UNREADABLE_ARTWORK } from '@plyr/next-core/publishing/artwork-model';

function decodeHeic(file: File): Promise<ImageBitmap> {
  const worker = new Worker(new URL('./cover-heic.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<ImageBitmap>((resolve, reject) => {
    const failed = () => reject(new Error(UNREADABLE_ARTWORK));
    worker.onerror = failed;
    worker.onmessageerror = failed;
    worker.onmessage = (event: MessageEvent<ImageBitmap | null>) => {
      if (event.data) resolve(event.data);
      else failed();
    };
    worker.postMessage(file);
  }).finally(() => worker.terminate());
}

export async function coverImage(file: File, maximumEdge?: number): Promise<File> {
  const type = artworkType(file.type);
  const address = URL.createObjectURL(file);
  let bitmap: ImageBitmap | undefined;
  try {
    const image = new Image();
    image.src = address;
    try {
      await image.decode();
    } catch {
      if (!/^image\/hei[cf](?:-sequence)?$/.test(type) && !/\.hei[cf]$/i.test(file.name)) throw new Error(UNREADABLE_ARTWORK);
      bitmap = await decodeHeic(file).catch(() => { throw new Error(UNREADABLE_ARTWORK); });
    }
    const originalWidth = bitmap?.width ?? image.naturalWidth;
    const originalHeight = bitmap?.height ?? image.naturalHeight;
    const plan = artworkPlan(bitmap ? { type: 'image/heic', size: file.size } : file, originalWidth, originalHeight);
    const edge = Math.max(originalWidth, originalHeight);
    const override = maximumEdge && edge > maximumEdge && type !== 'image/gif';
    if (plan.keep && !override) return type === file.type ? file : new File([file], file.name, { type });
    const plannedWidth = plan.keep ? originalWidth : plan.width ?? originalWidth;
    const width = Math.min(plannedWidth, override ? Math.round(originalWidth * maximumEdge / edge) : originalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(originalHeight * width / originalWidth);
    const context = canvas.getContext('2d');
    if (!context || !width || !canvas.height) throw new Error(UNREADABLE_ARTWORK);
    context.drawImage(bitmap ?? image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.65]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_ARTWORK_BYTES) return new File([blob], artworkName(file.name), { type: 'image/jpeg' });
    }
    throw new Error('that image is too large. choose a smaller one.');
  } finally {
    bitmap?.close();
    URL.revokeObjectURL(address);
  }
}
