import { canonicalAudioType } from '@plyr/next-core/publishing/upload-queue-model';

export function canonicalAudioFile(file: File): File {
  const type = canonicalAudioType(file);
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}
