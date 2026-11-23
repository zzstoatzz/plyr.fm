import { createAudioPlayer } from 'expo-audio';
import { getDocumentAsync } from 'expo-document-picker';
import { File as LocalFile } from 'expo-file-system';
import type { MediaFile } from './pds';

export async function pickMedia(type: 'audio/*' | 'image/*'): Promise<MediaFile | null> {
  const result = await getDocumentAsync({ type, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new LocalFile(asset.uri);
  return {
    name: asset.name,
    uri: asset.uri,
    type: asset.mimeType ?? file.type,
    size: asset.size ?? file.size,
    arrayBuffer: () => file.arrayBuffer()
  };
}

/** Several audio files at once: in Files, open the folder and tap select all. */
export async function pickAudioFiles(): Promise<MediaFile[]> {
  const result = await getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: true });
  if (result.canceled) return [];
  return result.assets.map(asset => {
    const file = new LocalFile(asset.uri);
    return { name: asset.name, uri: asset.uri, type: asset.mimeType ?? file.type, size: asset.size ?? file.size, arrayBuffer: () => file.arrayBuffer() };
  });
}

export async function measureAudioDuration(file: MediaFile): Promise<number | undefined> {
  const source = file.uri;
  if (!source) return;
  const player = createAudioPlayer(source);
  try {
    return await new Promise<number | undefined>((resolve) => {
      const finish = (duration?: number) => {
        clearTimeout(timeout);
        subscription.remove();
        resolve(duration);
      };
      const timeout = setTimeout(() => finish(), 2500);
      const subscription = player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded && status.duration > 0 && Number.isFinite(status.duration)) finish(status.duration);
      });
    });
  } finally {
    player.remove();
  }
}

/** The same picked file under another content type, e.g. an MP3 a share sheet sent as application/octet-stream. */
export function retype(file: MediaFile, type: string): MediaFile {
  if (file.type === type) return file;
  return { name: file.name, uri: file.uri, size: file.size, type, arrayBuffer: () => file.arrayBuffer() };
}
