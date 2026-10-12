import { describe, expect, it } from 'vitest';
import { corsSource, isIosWebKit } from './eq.svelte';

const API = 'https://api.example.com';

describe('corsSource', () => {
	it('loads public audio anonymously, untouched', () => {
		expect(corsSource(`${API}/audio/abc`, false, API)).toEqual({
			src: `${API}/audio/abc`,
			crossOrigin: 'anonymous'
		});
	});

	it('asks the backend to serve gated audio itself, with the session cookie', () => {
		expect(corsSource(`${API}/audio/abc`, true, API)).toEqual({
			src: `${API}/audio/abc?cors=1`,
			crossOrigin: 'use-credentials'
		});
	});

	it('leaves cached blobs alone: they are same-origin already', () => {
		expect(corsSource('blob:https://plyr.fm/123', true, API)).toEqual({
			src: 'blob:https://plyr.fm/123',
			crossOrigin: null
		});
	});
});

describe('isIosWebKit', () => {
	it('catches iPhones and iPads that report as desktop macs', () => {
		expect(
			isIosWebKit({
				userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
				platform: 'iPhone',
				maxTouchPoints: 5
			})
		).toBe(true);
		expect(
			isIosWebKit({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })
		).toBe(true);
	});

	it('lets desktop and android through', () => {
		expect(
			isIosWebKit({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })
		).toBe(false);
		expect(
			isIosWebKit({
				userAgent: 'Mozilla/5.0 (Linux; Android 15)',
				platform: 'Linux armv8l',
				maxTouchPoints: 5
			})
		).toBe(false);
	});
});
