import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { pickMedia } from '../media-picker';
import type { MediaFile } from '../pds';
import { artworkName, artworkPlan, MAX_ARTWORK_BYTES, UNREADABLE_ARTWORK } from './artwork-model';

async function encode(url: string, name: string, width?: number): Promise<MediaFile> {
  const context = ImageManipulator.manipulate(url);
  if (width) context.resize({ width });
  const image = await context.renderAsync();
  for (const compress of [0.9, 0.8, 0.65]) {
    const blob = await (await fetch((await image.saveAsync({ format: SaveFormat.JPEG, compress })).uri)).blob();
    if (blob.size <= MAX_ARTWORK_BYTES) return new File([blob], artworkName(name), { type: 'image/jpeg' });
  }
  throw new Error('that image is too large. choose a smaller one.');
}

/** A cover the track lexicon accepts, converted in the browser from whatever image was picked. Null when cancelled. */
export async function pickArtwork(): Promise<MediaFile | null> {
  const file = await pickMedia('image/*');
  if (!file) return null;
  const plan = artworkPlan(file);
  if (plan.keep) return file;
  const url = URL.createObjectURL(file as unknown as Blob);
  try { return await encode(url, file.name, plan.width); }
  catch (failure) { throw failure instanceof Error && failure.message.includes('too large') ? failure : new Error(UNREADABLE_ARTWORK); }
  finally { URL.revokeObjectURL(url); }
}
