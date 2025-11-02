<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg';
		color?: string;
	}

	let { size = 'md', color }: Props = $props();

	const sizeMap = {
		sm: '16px',
		md: '24px',
		lg: '32px'
	};
</script>

<div class="spinner" style:--size={sizeMap[size]} style:--color={color || 'var(--accent)'}>
	<svg viewBox="0 0 24 24" fill="none">
		<circle
			cx="12"
			cy="12"
			r="10"
			stroke="currentColor"
			stroke-width="3"
			stroke-linecap="round"
			stroke-dasharray="32 32"
		/>
	</svg>
</div>

<style>
	.spinner {
		width: var(--size);
		height: var(--size);
		color: var(--color);
		animation: spin 1s linear infinite;
	}

	svg {
		width: 100%;
		height: 100%;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
