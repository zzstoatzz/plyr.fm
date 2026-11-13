import type { MediaFile } from '../pds';

export function useSharedAudio(_receive: (file: MediaFile) => void) {}

export function usePendingSharedAudio(): string | undefined { return undefined; }
