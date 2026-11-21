import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync, UIImagePickerPreferredAssetRepresentationMode } from 'expo-image-picker';
import { File as LocalFile } from 'expo-file-system';
import { MAX_AVATAR_BYTES } from '@plyr/next-core/profile-record';
import type { MediaFile } from '../pds';

const EDGE = 1000;

/** A square avatar from the photo library, as a JPEG under the profile's 1 MB limit. Null when cancelled. */
export async function pickAvatar(): Promise<MediaFile | null> {
  // allowsEditing gives the native square crop; Compatible asks iOS for a JPEG rendition of HEIC photos.
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1,
    preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible });
  if (result.canceled) return null;
  const asset = result.assets[0];
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    const side = Math.min(asset.width, asset.height);
    if (asset.width !== asset.height) context.crop({ originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side });
    if (side > EDGE) context.resize({ width: EDGE });
    const image = await context.renderAsync();
    for (const compress of [0.9, 0.8, 0.65]) {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress });
      const file = new LocalFile(saved.uri);
      if (file.size <= MAX_AVATAR_BYTES) return { name: 'avatar.jpg', uri: saved.uri, type: 'image/jpeg', size: file.size, arrayBuffer: () => file.arrayBuffer() };
    }
  } catch {
    throw new Error('could not open this image. choose a different photo.');
  }
  throw new Error('that image is too large. choose a smaller one.');
}
