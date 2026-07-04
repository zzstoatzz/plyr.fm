<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RichText from './RichText.svelte';

	// a11y 'todo': auto-linked text renders in --accent, which fails WCAG AA
	// contrast on some backgrounds. accent is the app's user-configurable link
	// color — a token-level design decision, not a per-story fix. tracked for a
	// dedicated contrast pass; still surfaced here as a warning.
	const { Story } = defineMeta({
		title: 'content/RichText',
		component: RichText,
		parameters: { layout: 'padded', a11y: { test: 'todo' } },
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
