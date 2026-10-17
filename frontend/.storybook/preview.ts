import type { Preview } from '@storybook/sveltekit';
import '../src/lib/styles/theme.css';

const THEMES = ['dark', 'light'] as const;

const preview: Preview = {
	initialGlobals: { theme: import.meta.env.VITE_STORYBOOK_THEME === 'light' ? 'light' : 'dark' },
	globalTypes: {
		theme: {
			description: 'plyr.fm theme',
			toolbar: {
				title: 'theme',
				icon: 'contrast',
				items: [
					{ value: 'dark', title: 'dark', icon: 'moon' },
					{ value: 'light', title: 'light', icon: 'sun' }
				],
				dynamicTitle: true
			}
		}
	},
	decorators: [
		(story, context) => {
			const theme = context.globals.theme ?? 'dark';
			const root = document.documentElement;
			for (const t of THEMES) root.classList.remove(`theme-${t}`);
			root.classList.add(`theme-${theme}`);
			return story();
		}
	],
	parameters: {
		layout: 'centered',
		controls: {
			matchers: { color: /(background|color)$/i, date: /Date$/i }
		},
		a11y: { test: 'error' },
		options: {
			storySort: {
				order: [
					'Introduction',
					'Foundations',
					['Colors', 'Typography', 'Radius'],
					'badges',
					'content',
					'inputs',
					'overlays',
					'media',
					'feedback',
					'loading',
					'track',
					'portal'
				]
			}
		}
	}
};

export default preview;
