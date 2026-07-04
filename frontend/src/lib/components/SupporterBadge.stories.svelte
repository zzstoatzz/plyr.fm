<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SupporterBadge from './SupporterBadge.svelte';

	const { Story } = defineMeta({
		title: 'badges/SupporterBadge',
		component: SupporterBadge,
		parameters: { layout: 'centered' }
	});
</script>

<Story name="Default" />
