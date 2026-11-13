import { useEffect, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { useIncomingShare } from 'expo-sharing';
import type { MediaFile } from '../pds';

/** Hands audio shared into the app (Voice Memos, Files) to `receive`, once per share. */
export function useSharedAudio(receive: (file: MediaFile) => void, fail: (message: string) => void) {
  const { resolvedSharedPayloads, clearSharedPayloads } = useIncomingShare();
  const latest = useRef({ receive, fail });
  latest.current = { receive, fail };
  useEffect(() => {
    const shared = resolvedSharedPayloads.find(payload => payload.contentUri && (payload.contentType === 'audio' || payload.contentMimeType?.startsWith('audio/')));
    if (!shared?.contentUri) return;
    try {
      const source = new File(shared.contentUri);
      const name = shared.originalName ?? source.name;
      const extension = name.split('.').at(-1)?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'm4a';
      const directory = new Directory(Paths.cache, 'plyr-shared');
      if (!directory.exists) directory.create();
      // Memo titles carry quotes and other characters; an ASCII name keeps the copy's URI unambiguous.
      const copy = new File(directory, `${randomUUID()}.${extension}`);
      source.copy(copy);
      if (!copy.exists || !copy.size) throw new Error('empty copy');
      latest.current.receive({ name, uri: copy.uri, type: shared.contentMimeType ?? copy.type, size: copy.size, arrayBuffer: () => copy.arrayBuffer() });
    } catch {
      latest.current.fail('the shared file could not be read. try sharing it again.');
    } finally { clearSharedPayloads(); }
  }, [resolvedSharedPayloads, clearSharedPayloads]);
}

/** Name of shared audio still waiting for an account to upload it, without taking it. */
export function usePendingSharedAudio(): string | undefined {
  const { sharedPayloads } = useIncomingShare();
  const shared = sharedPayloads.find(payload => payload.shareType === 'audio' || payload.mimeType?.startsWith('audio/'));
  return shared ? decodeURIComponent(shared.value.split('/').at(-1) ?? '') || 'shared audio' : undefined;
}
