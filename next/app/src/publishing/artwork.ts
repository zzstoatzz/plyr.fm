import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync, UIImagePickerPreferredAssetRepresentationMode } from 'expo-image-picker';
import { File as LocalFile } from 'expo-file-system';
import type { MediaFile } from '../pds';
import { artworkName, artworkPlan, artworkType, MAX_ARTWORK_BYTES, UNREADABLE_ARTWORK } from './artwork-model';

async function encode(uri: string, name: string, width?: number): Promise<MediaFile> {
  const context = ImageManipulator.manipulate(uri);
  if (width) context.resize({ width });
  const image = await context.renderAsync();
  for (const compress of [0.9, 0.8, 0.65]) {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress });
    const file = new LocalFile(saved.uri);
    if (file.size <= MAX_ARTWORK_BYTES) return { name: artworkName(name), uri: saved.uri, type: 'image/jpeg', size: file.size, arrayBuffer: () => file.arrayBuffer() };
  }
  throw new Error('that image is too large. choose a smaller one.');
}

/** A cover from the photo library, converted to what the track lexicon accepts. Null when cancelled. */
export async function pickArtwork(): Promise<MediaFile | null> {
  // Compatible asks iOS for a JPEG rendition of HEIC photos.
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const name = asset.fileName ?? 'cover.jpg';
  const local = new LocalFile(asset.uri);
  const file = { name, uri: asset.uri, type: artworkType(asset.mimeType ?? local.type ?? ''), size: asset.fileSize ?? local.size };
  const plan = artworkPlan(file, asset.width, asset.height);
  if (plan.keep) return { ...file, arrayBuffer: () => local.arrayBuffer() };
  try { return await encode(asset.uri, name, plan.width); }
  catch (failure) { throw failure instanceof Error && failure.message.includes('too large') ? failure : new Error(UNREADABLE_ARTWORK); }
}
