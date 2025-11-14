<script lang="ts">
	import { API_URL } from '$lib/config';

	interface Liker {
		did: string;
		handle: string;
		display_name: string;
		avatar_url?: string;
		liked_at: string;
	}

	interface Props {
		trackId: number;
		likeCount: number;
	}

	let { trackId, likeCount }: Props = $props();

	let likers = $state<Liker[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		if (likeCount === 0) {
			loading = false;
			return;
		}

		const fetchLikers = async () => {
			try {
				const url = `${API_URL}/tracks/${trackId}/likes`;
				const response = await fetch(url);

				if (!response.ok) {
					throw new Error(`failed to fetch likers: ${response.status}`);
				}

				const data = await response.json();
				likers = data.users || [];
			} catch (err) {
				error = 'failed to load';
				console.error('error fetching likers:', err);
			} finally {
				loading = false;
			}
		};

		fetchLikers();
	});
</script>

<span class="likers-inline">
	{#if loading}
		<span class="likes-text">loading likes...</span>
	{:else if error}
		<span class="likes-text">{likeCount} {likeCount === 1 ? 'like' : 'likes'}</span>
	{:else if likers.length > 0}
		<span class="likes-text">
			{likeCount} {likeCount === 1 ? 'like' : 'likes'} from
			{#each likers.slice(0, 3) as liker, i}
				{#if i > 0}{i === likers.length - 1 && likers.length <= 3 ? ' and ' : ', '}{/if}<a href="/u/{liker.handle}" class="liker-link">{liker.display_name}</a>
			{/each}{#if likers.length > 3}
				and {likers.length - 3} {likers.length - 3 === 1 ? 'other' : 'others'}
			{/if}
		</span>
	{:else}
		<span class="likes-text">{likeCount} {likeCount === 1 ? 'like' : 'likes'}</span>
	{/if}
</span>

<style>
	.likers-inline {
		color: #999;
		font-family: inherit;
		font-size: 0.8rem;
	}

	.likes-text {
		color: #999;
	}

	.liker-link {
		color: var(--accent);
		text-decoration: none;
		transition: opacity 0.2s;
	}

	.liker-link:hover {
		opacity: 0.8;
		text-decoration: underline;
	}
</style>
