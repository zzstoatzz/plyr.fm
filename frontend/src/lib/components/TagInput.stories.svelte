<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import TagInput from './TagInput.svelte';

	const { Story } = defineMeta({
		title: 'inputs/TagInput',
		component: TagInput,
		parameters: { layout: 'padded' },
		args: { onAdd: fn(), onRemove: fn() }
	});
</script>

<Story name="Empty" args={{ tags: [] }} />

<Story name="With tags" args={{ tags: ['ambient', 'lo-fi', 'field-recording'] }} />

<Story name="Disabled" args={{ tags: ['house', 'disco'], disabled: true }} />
