import type { MediaFile } from '../pds';

/** Native picks are already files on disk, so their URI shows as is. */
export function usePreviewUri(file: MediaFile | null) {
  return file?.uri;
}
