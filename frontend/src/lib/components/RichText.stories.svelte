<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RichText from './RichText.svelte';

	const { Story } = defineMeta({
		title: 'content/RichText',
		component: RichText,
		parameters: { layout: 'padded' },
		argTypes: { text: { control: 'text' } }
	});
</script>

<Story name="Plain text" args={{ text: 'just some words, nothing to link here.' }} />

<Story
	name="Bare URL"
	args={{ text: 'listen at https://plyr.fm/radio — it autoplays.' }}
/>

<Story
	name="Markdown link"
	args={{ text: 'read the [copyright docs](https://docs.plyr.fm/artists/#copyright-detection) for details.' }}
/>

<Story
	name="Domain/path URL"
	args={{ text: 'source is on github.com/zzstoatzz/plyr.fm if you want to poke around.' }}
/>
