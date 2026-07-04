<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import WaveLoading from './WaveLoading.svelte';

	const { Story } = defineMeta({
		title: 'loading/WaveLoading',
		component: WaveLoading,
		parameters: { layout: 'centered' },
		argTypes: {
			size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
			message: { control: 'text' }
		}
	});
</script>

<Story name="Small" args={{ size: 'sm' }} />
<Story name="Medium" args={{ size: 'md' }} />
<Story name="Large" args={{ size: 'lg' }} />
<Story name="With message" args={{ size: 'md', message: 'loading tracks…' }} />
