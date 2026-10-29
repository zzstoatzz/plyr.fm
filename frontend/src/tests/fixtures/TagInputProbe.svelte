<script lang="ts">
	import TagInput from '$lib/components/TagInput.svelte';
	let tags = $state<string[]>([]);
	let saved = $state<string[]>([]);
</script>

<TagInput
	bind:tags
	onAdd={(tag) => (tags = [...tags, tag])}
	onRemove={(tag) => (tags = tags.filter((value) => value !== tag))}
/>
<button type="button" onclick={() => (saved = [...tags])}>save tags</button>
<output>{JSON.stringify(saved)}</output>
