<script lang="ts">
	import { devices } from '$lib/devices.svelte';
	import { jam } from '$lib/jam.svelte';

	let open = $state(false);
	let pickerRef = $state<HTMLDivElement | null>(null);

	function toggle() {
		open = !open;
	}

	function handleClickOutside(event: MouseEvent) {
		if (pickerRef && !pickerRef.contains(event.target as Node)) {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener('pointerdown', handleClickOutside);
			return () => document.removeEventListener('pointerdown', handleClickOutside);
		}
	});
</script>

{#if devices.otherDevices.length > 0}
	<div class="device-picker" bind:this={pickerRef}>
		<button class="picker-btn" onclick={toggle} title="devices">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
				<polyline points="17 2 12 7 7 2"></polyline>
			</svg>
		</button>

		{#if open}
			<div class="dropdown">
				<div class="dropdown-header">devices</div>
				{#each devices.devices as device (device.device_id)}
					{@const isCurrent = device.device_id === devices.deviceId}
					<div class="device-row" class:current={isCurrent}>
						<div class="device-info">
							<span class="device-name">
								{device.name}
								{#if isCurrent}
									<span class="badge">this device</span>
								{/if}
							</span>
							{#if !isCurrent}
								<span class="device-status">
									{device.is_playing ? 'playing' : 'idle'}
								</span>
							{/if}
						</div>
						{#if !isCurrent}
							<button
								class="play-here-pill"
								disabled={jam.active}
								onclick={() => {
									devices.transferTo(device.device_id);
									open = false;
								}}
								title={jam.active ? 'jam controls playback' : `play on ${device.name}`}
							>
								play here
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.device-picker {
		position: relative;
	}

	.picker-btn {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-full);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.picker-btn:hover {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.dropdown {
		position: absolute;
		bottom: calc(100% + 8px);
		right: 0;
		min-width: 220px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 0.375rem 0;
		z-index: 200;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
	}

	.dropdown-header {
		padding: 0.375rem 0.75rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-transform: lowercase;
		letter-spacing: 0.04em;
	}

	.device-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.75rem;
		gap: 0.5rem;
	}

	.device-row.current {
		opacity: 0.8;
	}

	.device-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.device-name {
		font-size: var(--text-sm);
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.badge {
		font-size: var(--text-xs);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius-full);
		padding: 0 0.375rem;
		white-space: nowrap;
		line-height: 1.5;
	}

	.device-status {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.play-here-pill {
		padding: 0.125rem 0.5rem;
		font-size: var(--text-xs);
		font-family: inherit;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.play-here-pill:hover:not(:disabled) {
		color: var(--accent);
		border-color: var(--accent);
	}

	.play-here-pill:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
</style>
