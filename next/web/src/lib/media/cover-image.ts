import { artworkName, artworkPlan, artworkType, MAX_ARTWORK_BYTES, UNREADABLE_ARTWORK } from '$core/publishing/artwork-model';

export async function coverImage(file: File): Promise<File> {
  const type = artworkType(file.type);
  if (artworkPlan(file).keep) return type === file.type ? file : new File([file], file.name, { type });

  const address = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = address;
    await image.decode();
    const plan = artworkPlan(file, image.naturalWidth, image.naturalHeight);
    const width = plan.keep ? image.naturalWidth : Math.min(image.naturalWidth, plan.width ?? image.naturalWidth);
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
