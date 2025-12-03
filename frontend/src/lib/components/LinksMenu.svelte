<script lang="ts">
	import PlatformStats from './PlatformStats.svelte';

	let showMenu = $state(false);

	function toggleMenu() {
		showMenu = !showMenu;
	}

	function closeMenu() {
		showMenu = false;
	}
</script>

<div class="links-menu">
	<button class="menu-button" onclick={toggleMenu} title="view links">
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="10"></circle>
			<line x1="12" y1="16" x2="12" y2="12"></line>
			<line x1="12" y1="8" x2="12.01" y2="8"></line>
		</svg>
	</button>

	{#if showMenu}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="menu-backdrop" onclick={closeMenu}></div>
		<div class="menu-popover">
			<div class="menu-header">
				<span>links</span>
				<button
					class="close-button"
					onclick={closeMenu}
					aria-label="close"
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<nav class="menu-links">
				<a
					href="https://bsky.app/profile/plyr.fm"
					target="_blank"
					rel="noopener noreferrer"
					class="menu-link"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 600 530"
						fill="currentColor"
					>
						<path
							d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"
						/>
					</svg>
					<div class="link-info">
						<span class="link-title">bluesky profile</span>
						<span class="link-subtitle">@plyr.fm</span>
					</div>
				</a>
				<a
					href="https://status.zzstoatzz.io/@plyr.fm"
					target="_blank"
					rel="noopener noreferrer"
					class="menu-link"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"
						></polyline>
					</svg>
					<div class="link-info">
						<span class="link-title">status page</span>
					</div>
				</a>
			</nav>
			<PlatformStats variant="menu" />
		</div>
	{/if}
</div>

<style>
	.links-menu {
		position: relative;
	}

	.menu-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.menu-button:hover {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.menu-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 100;
		animation: fadeIn 0.15s ease-out;
	}

	.menu-popover {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(320px, calc(100vw - 2rem));
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		z-index: 101;
		animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.menu-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.menu-header span {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.close-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.close-button:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.menu-links {
		display: flex;
		flex-direction: column;
		padding: 0.5rem;
	}

	.menu-link {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		background: transparent;
		border-radius: 8px;
		text-decoration: none;
		color: var(--text-primary);
		transition: all 0.2s;
	}

	.menu-link:hover {
		background: var(--bg-hover);
	}

	.menu-link svg {
		flex-shrink: 0;
		color: var(--text-secondary);
		transition: color 0.2s;
	}

	.menu-link:hover svg {
		color: var(--accent);
	}

	.link-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.link-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.link-subtitle {
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translate(-50%, -48%) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	@media (max-width: 768px) {
		.menu-popover {
			top: auto;
			bottom: calc(var(--player-height, 0px) + 1rem + env(safe-area-inset-bottom, 0px));
			transform: translateX(-50%);
			max-height: calc(80vh - var(--player-height, 0px));
			overflow-y: auto;
			animation: slideInMobile 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		}

		@keyframes slideInMobile {
			from {
				opacity: 0;
				transform: translateX(-50%) translateY(10px);
			}
			to {
				opacity: 1;
				transform: translateX(-50%) translateY(0);
			}
		}
	}
</style>
