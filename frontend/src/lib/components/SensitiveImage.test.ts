// SensitiveImage blur contract: the viewer's saved preference can reveal
// sensitive artwork in the app, but unauthenticated contexts (embeds) pass
// respectPreference={false} and must always blur.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, unmount, createRawSnippet } from 'svelte';

const prefs = vi.hoisted(() => ({ showSensitiveArtwork: false }));
vi.mock('$lib/preferences.svelte', () => ({ preferences: prefs }));

const SENSITIVE_ART = 'https://images.test/images/sens123.webp';

let component: Record<string, unknown> | null = null;

async function mountSensitiveImage(props: Record<string, unknown>): Promise<HTMLImageElement> {
	const SensitiveImage = (await import('$lib/components/SensitiveImage.svelte')).default;
	const children = createRawSnippet(() => ({
		render: () => `<img class="art" src="${SENSITIVE_ART}" alt="" />`
	}));
	component = mount(SensitiveImage, {
		target: document.body,
		props: { src: SENSITIVE_ART, children, ...props }
	});
	const img = document.querySelector<HTMLImageElement>('img.art');
	expect(img).toBeTruthy();
	return img!;
}

beforeAll(async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			new Response(JSON.stringify({ image_ids: ['sens123'], urls: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		)
	);
	const { moderation } = await import('$lib/moderation.svelte');
	await moderation.fetch();
});

afterEach(() => {
	if (component) {
		unmount(component);
		component = null;
	}
	document.body.innerHTML = '';
});

describe('SensitiveImage', () => {
	it('blurs sensitive images by default', async () => {
		prefs.showSensitiveArtwork = false;
		const img = await mountSensitiveImage({});
		expect(img.closest('.sensitive-wrapper.blur')).toBeTruthy();
	});

	it('reveals sensitive images when the viewer opted in', async () => {
		prefs.showSensitiveArtwork = true;
		const img = await mountSensitiveImage({});
		expect(img.closest('.sensitive-wrapper.blur')).toBeNull();
	});

	it('always blurs when the viewer preference is unknowable (respectPreference=false)', async () => {
		prefs.showSensitiveArtwork = true;
		const img = await mountSensitiveImage({ respectPreference: false });
		expect(img.closest('.sensitive-wrapper.blur')).toBeTruthy();
	});
});
