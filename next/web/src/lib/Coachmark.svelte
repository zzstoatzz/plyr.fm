<script lang="ts">
	import type { Snippet } from 'svelte';
	let { dismiss, testid, children }: { dismiss: () => void; testid?: string; children: Snippet } = $props();
</script>

<!-- a one-time hint: what to try, and "got it" to put it away for good -->
<div class="coachmark" role="status" data-testid={testid}><span>{@render children()}</span><button type="button" class="text-button" onclick={dismiss}>got it</button></div>

<style>
	.coachmark { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; padding-inline: 0.6rem; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: 0.7rem; font-size: 0.85rem; }
	.coachmark button { flex: none; color: var(--accent); }
</style>
