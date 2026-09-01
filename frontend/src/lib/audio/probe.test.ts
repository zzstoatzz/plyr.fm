import { describe, expect, it } from 'vitest';
import {
	audioFormatOf,
	canRenderWaveform,
	formatClock,
	formatFileSize,
	isUsableDuration,
	mediaDuration,
	type MediaDurationSource,
	WAVEFORM_MAX_BYTES,
	WAVEFORM_MAX_SECONDS
} from './probe';

/** jsdom has no media pipeline: a source whose duration the test drives. */
class FakeMedia extends EventTarget implements MediaDurationSource {
	duration = Number.NaN;
	currentTime = 0;
	seekHistory: number[] = [];

	/** a header-less container: seeking past the end reveals the real length. */
	revealOnSeek(seconds: number): void {
		Object.defineProperty(this, 'currentTime', {
			set: (t: number) => {
				this.seekHistory.push(t);
				if (t > seconds && !isUsableDuration(this.duration)) {
					this.duration = seconds;
					void Promise.resolve().then(() => this.dispatchEvent(new Event('durationchange')));
				}
			},
			get: () => this.seekHistory.at(-1) ?? 0
		});
	}
}

describe('mediaDuration', () => {
	it('returns a known duration without seeking', async () => {
		const fake = new FakeMedia();
		fake.duration = 42.5;
		expect(await mediaDuration(fake)).toBe(42.5);
		expect(fake.seekHistory).toEqual([]);
	});

	it('scans a header-less container by seeking past the end, then rewinds', async () => {
		const fake = new FakeMedia();
		fake.revealOnSeek(12.25);
		expect(await mediaDuration(fake)).toBe(12.25);
		expect(fake.seekHistory[0]).toBeGreaterThan(1e100);
		expect(fake.seekHistory.at(-1)).toBe(0);
	});

	it('gives up on a media error', async () => {
		const fake = new FakeMedia();
		const pending = mediaDuration(fake);
		fake.dispatchEvent(new Event('error'));
		expect(await pending).toBeNull();
	});

	it('gives up when the scan never reports', async () => {
		const fake = new FakeMedia();
		expect(await mediaDuration(fake, 5)).toBeNull();
	});
});

describe('audioFormatOf', () => {
	it('takes the extension from the name', () => {
		expect(audioFormatOf('FastMCP_4.M4A')).toBe('m4a');
		expect(audioFormatOf('song.final.flac')).toBe('flac');
	});

	it('falls back to the mime type when the name has no extension', () => {
		expect(audioFormatOf('', 'audio/webm;codecs=opus')).toBe('webm');
		expect(audioFormatOf('recording', 'audio/mp4')).toBe('m4a');
		expect(audioFormatOf('recording')).toBe('');
	});
});

describe('canRenderWaveform', () => {
	it('allows a short file and refuses anything past either cap', () => {
		expect(canRenderWaveform(50 * 1024 * 1024, 200)).toBe(true);
		expect(canRenderWaveform(WAVEFORM_MAX_BYTES + 1, 200)).toBe(false);
		expect(canRenderWaveform(1024, WAVEFORM_MAX_SECONDS + 1)).toBe(false);
		expect(canRenderWaveform(1024, 200, 100)).toBe(false);
		expect(canRenderWaveform(1024, null)).toBe(false);
	});
});

describe('formatting', () => {
	it('formats clock times', () => {
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(75.9)).toBe('1:15');
		expect(formatClock(3600 + 65)).toBe('1:01:05');
		expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
	});

	it('formats sizes with fewer decimals as they grow', () => {
		expect(formatFileSize(3.14159 * 1024 * 1024)).toBe('3.1 MB');
		expect(formatFileSize(200.4 * 1024 * 1024)).toBe('200 MB');
		expect(formatFileSize(8 * 1024)).toBe('8 KB');
		expect(formatFileSize(10)).toBe('1 KB');
	});
});
