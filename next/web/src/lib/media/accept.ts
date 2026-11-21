import { audioPickerAccept } from '@plyr/next-core/publishing/upload-model';

/** What an audio picker accepts. Touch screens leave WebM out so the camera never shows up. */
export function audioAccept(): string {
	const touch = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;
	return audioPickerAccept(touch);
}
