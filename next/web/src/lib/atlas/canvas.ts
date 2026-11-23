import { AtlasRenderer } from './renderer';
import type { AtlasCallbacks } from '@plyr/next-core/atlas/types';

const ignore = () => {};
const still: AtlasCallbacks = { onHover: ignore, onHoverArtist: ignore, onActivate: ignore, onActivateArtist: ignore };

export function mountAtlas(canvas: HTMLCanvasElement, callbacks?: AtlasCallbacks) {
	const system = matchMedia('(prefers-color-scheme: dark)');
	const root = document.documentElement;
	const dark = () => root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && system.matches);
	const renderer = new AtlasRenderer(canvas, callbacks ?? still, { dark: dark(), preview: !callbacks });
	const theme = () => renderer.setDark(dark());
	const observer = new MutationObserver(theme);
	observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
	system.addEventListener('change', theme);
	return {
		renderer,
		destroy() {
			observer.disconnect();
			system.removeEventListener('change', theme);
			renderer.destroy();
		}
	};
}
