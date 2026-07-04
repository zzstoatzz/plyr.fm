import type { Preview } from '@storybook/sveltekit';
import './plyr-tokens.css';

// plyr.fm's components are theme-aware (dark by default, light under
// :root.theme-light). the toolbar toggle sets the class on the preview root so
// every story can be reviewed in both — half of what the components actually do.
const THEMES = ['dark', 'light'] as const;

const preview: Preview = {
	initialGlobals: { theme: 'dark' },
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
		// surface accessibility findings in the a11y panel for every story
		a11y: { test: 'todo' },
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
