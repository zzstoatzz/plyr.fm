import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

addons.setConfig({
	theme: create({
		base: 'dark',
		brandTitle: 'plyr.fm components',
		brandUrl: 'https://plyr.fm',
		colorPrimary: '#6a9fff',
		colorSecondary: '#6a9fff'
	})
});
