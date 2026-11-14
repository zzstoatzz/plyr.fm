import { useEffect, useMemo } from 'react';
import type { MediaFile } from '../pds';

/** A browser pick is a File with no URL; show it through an object URL for as long as it is chosen. */
export function usePreviewUri(file: MediaFile | null) {
  const url = useMemo(() => file?.uri ?? (file instanceof Blob ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); }, [url]);
  return url;
}
