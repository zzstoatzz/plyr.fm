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

	async function handleMoreClick(e: MouseEvent | KeyboardEvent) {
		// stop the click on +N from bubbling to an enclosing play button,
		// but only on this non-anchor element — anchor clicks (individual
		// avatars) must still reach document for SvelteKit's client-side
		// nav to hijack them, otherwise the browser does a full page reload
		// and tears down the audio element mid-playback.
		e.stopPropagation();
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
		} catch (err) {
			console.error('error expanding likers:', err);
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

	function formatRelativeTime(iso: string): string {
		const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
		return `${Math.floor(seconds / 604800)}w ago`;
	}

	function avatarTitle(u: UserPreview): string {
		const name = u.display_name || u.handle;
		return u.liked_at ? `${name} · liked ${formatRelativeTime(u.liked_at)}` : name;
	}
</script>

<!-- NOTE: we deliberately do NOT stopPropagation at this root. avatar clicks
     are anchor links and must reach document so SvelteKit's client-side nav
     can hijack them — otherwise the browser falls back to a full page
     reload which tears down the audio element and stops playback.
     The outer play button in TrackItem already has an anchor guard that
     prevents playback when the click target is (or is inside) an <a>.
     The non-anchor interactive bits (+N, ×) stop propagation individually. -->
<span
	class="likers-strip"
	class:expanded
	class:loading
	bind:this={container}
	aria-live="polite"
>
	<span class="label">liked by</span>
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
		{avatarTitle}
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
		gap: 0.375rem;
		vertical-align: middle;
		transition: opacity 0.15s;
	}

	.likers-strip.loading {
		opacity: 0.6;
	}

	.label {
		color: var(--text-tertiary);
		font-size: inherit;
		font-family: inherit;
		white-space: nowrap;
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
