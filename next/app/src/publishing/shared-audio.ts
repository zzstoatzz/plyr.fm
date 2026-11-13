import { useEffect, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { useIncomingShare } from 'expo-sharing';
import type { MediaFile } from '../pds';

/** Hands audio shared into the app (Voice Memos, Files) to `receive`, once per share. */
export function useSharedAudio(receive: (file: MediaFile) => void) {
  const { resolvedSharedPayloads, clearSharedPayloads } = useIncomingShare();
  const latest = useRef(receive);
  latest.current = receive;
  useEffect(() => {
    const shared = resolvedSharedPayloads.find(payload => payload.contentUri && (payload.contentType === 'audio' || payload.contentMimeType?.startsWith('audio/')));
    if (!shared?.contentUri) return;
    const source = new File(shared.contentUri);
    const directory = new Directory(Paths.cache, `plyr-shared-${randomUUID()}`);
    directory.create();
    const name = shared.originalName ?? source.name;
    const copy = new File(directory, name);
    source.copy(copy);
    clearSharedPayloads();
    latest.current({ name, uri: copy.uri, type: shared.contentMimeType ?? copy.type, size: copy.size, arrayBuffer: () => copy.arrayBuffer() });
  }, [resolvedSharedPayloads, clearSharedPayloads]);
}

/** Name of shared audio still waiting for an account to upload it, without taking it. */
export function usePendingSharedAudio(): string | undefined {
  const { sharedPayloads } = useIncomingShare();
  const shared = sharedPayloads.find(payload => payload.shareType === 'audio' || payload.mimeType?.startsWith('audio/'));
  return shared ? decodeURIComponent(shared.value.split('/').at(-1) ?? '') || 'shared audio' : undefined;
}
