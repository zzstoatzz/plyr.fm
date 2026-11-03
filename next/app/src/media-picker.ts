import { createAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { File as LocalFile } from 'expo-file-system';
import type { MediaFile } from './pds';

export async function pickMedia(type: 'audio/*' | 'image/*'): Promise<MediaFile | null> {
  const result = await getDocumentAsync({ type, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset.file) return asset.file;
  const file = new LocalFile(asset.uri);
  return {
    name: asset.name,
    uri: asset.uri,
    type: asset.mimeType ?? file.type,
    size: asset.size ?? file.size,
    arrayBuffer: () => file.arrayBuffer()
  };
}

export async function measureAudioDuration(file: MediaFile): Promise<number | undefined> {
  const objectUrl = Platform.OS === 'web' && file instanceof Blob ? URL.createObjectURL(file) : null;
  const source = objectUrl ?? file.uri;
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
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
