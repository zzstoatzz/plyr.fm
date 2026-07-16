// composite covers must request display-sized renditions: the preview cache
// stores full-size artwork URLs, and stretching a 96px thumbnail across a
// hero-sized mosaic quadrant (the pre-fix behavior) looks terrible.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import PlaylistCover from '$lib/components/PlaylistCover.svelte';
import { IMAGE_WIDTHS } from '$lib/utils/display-image';

const PREVIEWS = [1, 2, 3, 4].map((i) => `https://images.plyr.fm/images/art${i}.jpg`);

let component: Record<string, unknown> | null = null;

function mountCover(props: Record<string, unknown>): void {
	component = mount(PlaylistCover, { target: document.body, props });
}

afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

describe('PlaylistCover', () => {
	it('resizes mosaic quadrants to half the slot width', () => {
		mountCover({ previews: PREVIEWS, width: IMAGE_WIDTHS.hero });
		const srcs = [...document.querySelectorAll('.mosaic img')].map((img) =>
			img.getAttribute('src')
		);
		expect(srcs).toHaveLength(4);
		for (const [i, src] of srcs.entries()) {
			expect(src).toBe(
				`https://images.plyr.fm/cdn-cgi/image/width=${IMAGE_WIDTHS.hero / 2},quality=82,format=auto/images/art${i + 1}.jpg`
			);
		}
	});

	it('resizes a single-preview cover to the slot width', () => {
		mountCover({ previews: PREVIEWS.slice(0, 1), width: IMAGE_WIDTHS.hero });
		expect(document.querySelector('img.cover')?.getAttribute('src')).toBe(
			`https://images.plyr.fm/cdn-cgi/image/width=${IMAGE_WIDTHS.hero},quality=82,format=auto/images/art1.jpg`
		);
	});

	it('resizes an explicit cover and passes external hosts through', () => {
		mountCover({
			imageUrl: 'https://cdn.example.com/cover.jpg',
			previews: PREVIEWS,
			width: IMAGE_WIDTHS.thumb
		});
		expect(document.querySelector('img.cover')?.getAttribute('src')).toBe(
			'https://cdn.example.com/cover.jpg'
		);
	});
});
