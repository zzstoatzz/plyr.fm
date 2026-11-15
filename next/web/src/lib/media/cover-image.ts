import { artworkName, artworkPlan, artworkType, MAX_ARTWORK_BYTES, UNREADABLE_ARTWORK } from '@plyr/next-core/publishing/artwork-model';

export async function coverImage(file: File, maximumEdge?: number): Promise<File> {
  const type = artworkType(file.type);
  const address = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = address;
    await image.decode().catch(() => { throw new Error(UNREADABLE_ARTWORK); });
    const plan = artworkPlan(file, image.naturalWidth, image.naturalHeight);
    const edge = Math.max(image.naturalWidth, image.naturalHeight);
    const override = maximumEdge && edge > maximumEdge && type !== 'image/gif';
    if (plan.keep && !override) return type === file.type ? file : new File([file], file.name, { type });
    const plannedWidth = plan.keep ? image.naturalWidth : plan.width ?? image.naturalWidth;
    const width = Math.min(plannedWidth, override ? Math.round(image.naturalWidth * maximumEdge / edge) : image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(image.naturalHeight * width / image.naturalWidth);
    const context = canvas.getContext('2d');
    if (!context || !width || !canvas.height) throw new Error(UNREADABLE_ARTWORK);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.65]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_ARTWORK_BYTES) return new File([blob], artworkName(file.name), { type: 'image/jpeg' });
    }
    throw new Error('that image is too large. choose a smaller one.');
  } finally {
    URL.revokeObjectURL(address);
  }
}
