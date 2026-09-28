import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import RadioPage from './frontend/src/pages/radio/RadioPage';
import type { RadioIntegration } from './frontend/src/shared/lib/integration';
import globalCss from './frontend/src/styles/global.css?inline';
import shellCss from './frontend/src/pages/radio/radio-shell.css?inline';
import panelsCss from './frontend/src/pages/radio/radio-panels.css?inline';
import hostCss from './host.css?inline';

export function mountRadio(host: HTMLElement, initial: RadioIntegration) {
	const root = host.attachShadow({ mode: 'open' });
	const style = document.createElement('style');
	style.textContent = (
		globalCss.replace(/:root|\bbody\b|\bhtml\b/g, ':host') +
		shellCss +
		panelsCss +
		hostCss
	).replace(
		/rgb\(var\(--accent-rgb\) \/ (\d+%)\)/g,
		'color-mix(in srgb, var(--accent) $1, transparent)'
	);
	const handleKeydown = (event: Event): void => {
		if (!(event instanceof KeyboardEvent) || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.matches('input, textarea') ||
				target.isContentEditable ||
				(event.key === ' ' && target.closest('button')))
		)
			event.stopPropagation();
	};
	root.addEventListener('keydown', handleKeydown);
	const surface = document.createElement('div');
	root.append(style, surface);
	const [integration, update] = createSignal(initial);
	const dispose = render(() => <RadioPage integration={integration()} />, surface);
	return {
		update,
		dispose: () => {
			root.removeEventListener('keydown', handleKeydown);
			dispose();
		}
	};
}
