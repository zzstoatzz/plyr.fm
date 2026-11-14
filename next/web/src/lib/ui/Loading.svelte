<script lang="ts">
	// plyr's wave. the look lives in app.html (shared with the boot screen); it fades in after a
	// beat, so fast loads never flash it.
	let { size = 'md', label = 'loading', inline = false }: { size?: 'sm' | 'md' | 'lg'; label?: string; inline?: boolean } =
		$props();
</script>

<div class="loading" class:inline role="status">
	<span class="wave {size === 'md' ? '' : size}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
	<span class="label">{label}</span>
</div>

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s-md);
		padding: var(--s-5xl) var(--s-lg);
	}
	.loading.inline {
		flex-direction: row;
		justify-content: center;
		padding: var(--s-lg);
	}
	.label {
		font-size: var(--t-sm);
		color: var(--c-600);
		letter-spacing: 0.01em;
		animation: wave-in 0.4s 0.3s ease-out both;
	}
</style>
