// SensitiveImage blur contract: the viewer's saved preference can reveal
// sensitive artwork in the app, but unauthenticated contexts (embeds) pass
// respectPreference={false} and must always blur.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, unmount, createRawSnippet, type ComponentProps } from 'svelte';
import SensitiveImage from '$lib/components/SensitiveImage.svelte';
import { moderation } from '$lib/moderation.svelte';
import { preferences, type Preferences } from '$lib/preferences.svelte';

const SENSITIVE_ART = 'https://images.test/images/sens123.webp';

function prefs(showSensitiveArtwork: boolean): Preferences {
	return {
		accent_color: null,
		auto_advance: true,
		allow_comments: true,
		download_policy: null,
		hidden_tags: [],
		theme: 'dark',
		enable_teal_scrobbling: false,
		teal_needs_reauth: false,
		show_sensitive_artwork: showSensitiveArtwork,
		show_sensitive_audio: false,
		show_liked_on_profile: false,
		support_url: null,
		ui_settings: {},
		auto_download_liked: false,
		terms_accepted_at: null
	};
}

let cleanup: (() => void) | null = null;

function mountSensitiveImage(
	props: Partial<ComponentProps<typeof SensitiveImage>> = {}
): HTMLImageElement {
	const children = createRawSnippet(() => ({
		render: () => `<img class="art" src="${SENSITIVE_ART}" alt="" />`
	}));
	const component = mount(SensitiveImage, {
		target: document.body,
		props: { src: SENSITIVE_ART, children, ...props }
	});
	cleanup = () => unmount(component);
	const img = document.querySelector<HTMLImageElement>('img.art');
	if (!img) throw new Error('sensitive image child did not render');
	return img;
}

beforeAll(async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(async () =>
			new Response(JSON.stringify({ image_ids: ['sens123'], urls: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		)
	);
	await moderation.fetch();
});

afterEach(() => {
	cleanup?.();
	cleanup = null;
	document.body.innerHTML = '';
});

describe('SensitiveImage', () => {
	it('blurs sensitive images by default', () => {
		preferences.data = prefs(false);
		const img = mountSensitiveImage();
		expect(img.closest('.sensitive-wrapper.blur')).toBeTruthy();
	});

	it('reveals sensitive images when the viewer opted in', () => {
		preferences.data = prefs(true);
		const img = mountSensitiveImage();
		expect(img.closest('.sensitive-wrapper.blur')).toBeNull();
	});

	it('always blurs when the viewer preference is unknowable (respectPreference=false)', () => {
		preferences.data = prefs(true);
		const img = mountSensitiveImage({ respectPreference: false });
		expect(img.closest('.sensitive-wrapper.blur')).toBeTruthy();
	});
});
