<script lang="ts">
	import { API_URL } from '$lib/config';
	import { getLikers, setLikers, type LikerData } from '$lib/tooltip-cache.svelte';
	import type { UserPreview } from '$lib/types';
	import AvatarStack from './AvatarStack.svelte';

	interface Props {
		trackId: number;
		/** total like count (for the "+N" overflow label). */
		likeCount: number;
		/** preview likers embedded in the track response — up to 3. */
		topLikers: UserPreview[];
		/** avatar diameter. default 22. */
		size?: number;
		/** border color matching the surrounding background. */
		borderColor?: string;
		/** max width of the horizontal scroll container when expanded. */
		maxScrollWidth?: string;
	}

	let {
		trackId,
		likeCount,
		topLikers,
		size = 22,
		borderColor = 'var(--bg-secondary)',
		maxScrollWidth = '20rem'
	}: Props = $props();

	// expansion state: managed locally so each strip on a page is independent.
	let expanded = $state(false);
	let allLikers = $state<LikerData[] | null>(null);
	let loading = $state(false);
	let container: HTMLSpanElement | null = $state(null);

	// once the full list has been loaded, show everything — otherwise show the
	// 3 previewed likers the backend sent inline with the track response.
	let usersForStack = $derived<UserPreview[]>(
		expanded && allLikers ? allLikers : topLikers
	);

	async function fetchAllLikers(): Promise<LikerData[]> {
		const cached = getLikers(trackId);
		if (cached) return cached;
		const response = await fetch(`${API_URL}/tracks/${trackId}/likes`);
		if (!response.ok) throw new Error(`failed to fetch likers: ${response.status}`);
		const data = await response.json();
		const users: LikerData[] = data.users ?? [];
		setLikers(trackId, users);
		return users;
	}

	async function handleMoreClick() {
		if (loading) return;
		if (allLikers) {
			// already loaded — just toggle. second click collapses.
			expanded = !expanded;
			return;
		}
		loading = true;
		try {
			allLikers = await fetchAllLikers();
			expanded = true;
		} catch (e) {
			console.error('error expanding likers:', e);
		} finally {
			loading = false;
		}
	}

	// click-outside to collapse: the expanded horizontal scroll is transient.
	// click-to-expand, click-again (on +N) or click-outside to collapse.
	function handleDocumentClick(e: MouseEvent) {
		if (!expanded || !container) return;
		if (e.target instanceof Node && !container.contains(e.target)) {
			expanded = false;
		}
	}

	function handleDocumentKeydown(e: KeyboardEvent) {
		if (expanded && e.key === 'Escape') {
			expanded = false;
		}
	}

	$effect(() => {
		if (!expanded) return;
		document.addEventListener('click', handleDocumentClick, true);
		document.addEventListener('keydown', handleDocumentKeydown);
		return () => {
			document.removeEventListener('click', handleDocumentClick, true);
			document.removeEventListener('keydown', handleDocumentKeydown);
		};
	});

	let likeWord = $derived(likeCount === 1 ? 'like' : 'likes');
</script>

<span
	class="likers-strip"
	class:expanded
	class:loading
	bind:this={container}
	aria-live="polite"
>
	<AvatarStack
		users={usersForStack}
		total={likeCount}
		maxVisible={expanded ? likeCount : 3}
		{size}
		{borderColor}
		{maxScrollWidth}
		scrollable={expanded}
		onMoreClick={expanded ? undefined : handleMoreClick}
		avatarHref={(u) => `/u/${u.handle}`}
		ariaLabel={`${likeCount} ${likeWord}`}
	/>
	{#if expanded}
		<button
			class="collapse"
			type="button"
			onclick={(e) => {
				e.stopPropagation();
				expanded = false;
			}}
			title="collapse"
			aria-label="collapse likers"
			style="--collapse-size: {size}px;"
		>
			<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<line x1="6" y1="6" x2="14" y2="14"></line>
				<line x1="14" y1="6" x2="6" y2="14"></line>
			</svg>
		</button>
	{/if}
</span>

<style>
	.likers-strip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		vertical-align: middle;
		transition: opacity 0.15s;
	}

	.likers-strip.loading {
		opacity: 0.6;
	}

	.collapse {
		width: var(--collapse-size);
		height: var(--collapse-size);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		margin-left: 0.25rem;
		background: transparent;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-full);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, transform 0.15s;
		flex-shrink: 0;
	}

	.collapse:hover,
	.collapse:focus-visible {
		color: var(--accent);
		border-color: var(--accent);
		transform: scale(1.08);
	}

	.collapse svg {
		width: 55%;
		height: 55%;
	}
</style>
