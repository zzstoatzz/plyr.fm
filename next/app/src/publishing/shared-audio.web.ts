import type { MediaFile } from '../pds';

export function useSharedAudio(_receive: (file: MediaFile) => void, _fail: (message: string) => void) {}

export function usePendingSharedAudio(): string | undefined { return undefined; }
