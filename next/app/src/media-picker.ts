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
    type: asset.mimeType ?? file.type,
    size: asset.size ?? file.size,
    arrayBuffer: () => file.arrayBuffer()
  };
}
