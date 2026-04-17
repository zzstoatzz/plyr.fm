<script lang="ts">
	import type { UserPreview } from '$lib/types';

	interface Props {
		/** users to render, already sorted (most-relevant first). */
		users: UserPreview[];
		/** total number of users this stack represents (for the "+N" overflow). */
		total: number;
		/** max avatars to render before overflowing to "+N". default 3. */
		maxVisible?: number;
		/** avatar diameter in pixels. default 24. */
		size?: number;
		/** CSS color for the hairline ring separating stacked avatars.
		 *  must match the background the stack sits on, or the overlap looks
		 *  muddy. default `var(--bg-secondary)`. */
		borderColor?: string;
		/** URL for the "+N" tile to link to (e.g. external supporter list). */
		moreHref?: string;
		/** target attribute for `moreHref`, when set. */
		moreTarget?: '_blank' | '_self';
		/** handler for clicks on the "+N" tile (mutually exclusive with moreHref). */
		onMoreClick?: (e: MouseEvent | KeyboardEvent) => void;
		/** build a per-user link target. if omitted, avatars render as spans. */
		avatarHref?: (u: UserPreview) => string;
		/** handler for clicks on individual avatars (e.g. stop propagation). */
		onAvatarClick?: (u: UserPreview, e: MouseEvent) => void;
		/** accessible label for the strip (e.g. "21 likes"). */
		ariaLabel?: string;
		/** extra class on the container, for site-specific tweaks. */
		class?: string;
		/** if true, the stack becomes horizontally scrollable within `maxScrollWidth`
		 *  and the overlap is slightly reduced so individual avatars are easier
		 *  to tap. use for the "expanded" state when the caller has loaded the
		 *  full liker/supporter list. */
		scrollable?: boolean;
		/** max width of the stack container in scrollable mode. default `20rem`. */
		maxScrollWidth?: string;
	}

	let {
		users,
		total,
		maxVisible = 3,
		size = 24,
		borderColor = 'var(--bg-secondary)',
		moreHref,
		moreTarget = '_self',
		onMoreClick,
		avatarHref,
		onAvatarClick,
		ariaLabel,
		class: klass = '',
		scrollable = false,
		maxScrollWidth = '20rem'
	}: Props = $props();

	let visible = $derived(users.slice(0, maxVisible));
	let overflow = $derived(Math.max(0, total - visible.length));
	// overlap grows with size so the visual density stays consistent.
	let overlap = $derived(Math.round(size / 4));

	function fallbackInitial(u: UserPreview): string {
		return (u.display_name || u.handle || '?').charAt(0).toUpperCase();
	}

	function handleMoreKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onMoreClick?.(e);
		}
	}
</script>

<span
	class="avatar-stack {klass}"
	class:scrollable
	role={ariaLabel ? 'group' : undefined}
	aria-label={ariaLabel}
	style="--stack-size: {size}px; --stack-overlap: {overlap}px; --stack-border: {borderColor}; --stack-max-width: {maxScrollWidth};"
>
	{#each visible as user (user.did)}
		{@const title = user.display_name || user.handle}
		{#if avatarHref}
			<a
				class="avatar"
				href={avatarHref(user)}
				{title}
				onclick={(e) => onAvatarClick?.(user, e)}
			>
				{#if user.avatar_url}
					<img src={user.avatar_url} alt="" loading="lazy" />
				{:else}
					<span class="fallback">{fallbackInitial(user)}</span>
				{/if}
			</a>
		{:else}
			<span class="avatar static" {title}>
				{#if user.avatar_url}
					<img src={user.avatar_url} alt="" loading="lazy" />
				{:else}
					<span class="fallback">{fallbackInitial(user)}</span>
				{/if}
			</span>
		{/if}
	{/each}
	{#if overflow > 0}
		{#if moreHref}
			<a
				class="avatar more"
				href={moreHref}
				target={moreTarget}
				rel={moreTarget === '_blank' ? 'noopener' : undefined}
				title={ariaLabel ?? `${overflow} more`}
			>+{overflow}</a>
		{:else if onMoreClick}
			<span
				class="avatar more"
				role="button"
				tabindex="0"
				title={ariaLabel ?? `${overflow} more`}
				onclick={(e) => onMoreClick(e)}
				onkeydown={handleMoreKeydown}
			>+{overflow}</span>
		{:else}
			<span class="avatar more" title={ariaLabel ?? `${overflow} more`}>+{overflow}</span>
		{/if}
	{/if}
</span>

<style>
	.avatar-stack {
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
	}

	/* expanded mode: horizontal scroll so the full list is reachable without
	   a separate popover. overlap is preserved so the stack keeps its
	   visual identity — it doesn't morph into a different widget. */
	.avatar-stack.scrollable {
		max-width: var(--stack-max-width);
		overflow-x: auto;
		overflow-y: visible;
		padding: 4px 0;
		scrollbar-width: thin;
		scrollbar-color: var(--border-default) transparent;
		scroll-snap-type: x proximity;
		-webkit-overflow-scrolling: touch;
	}

	.avatar-stack.scrollable::-webkit-scrollbar {
		height: 4px;
	}

	.avatar-stack.scrollable::-webkit-scrollbar-track {
		background: transparent;
	}

	.avatar-stack.scrollable::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: 2px;
	}

	.avatar-stack.scrollable .avatar {
		scroll-snap-align: center;
	}

	.avatar {
		width: var(--stack-size);
		height: var(--stack-size);
		border-radius: var(--radius-full);
		border: 2px solid var(--stack-border);
		background: var(--bg-tertiary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		margin-left: calc(var(--stack-overlap) * -1);
		position: relative;
		text-decoration: none;
		flex-shrink: 0;
		color: var(--text-secondary);
		transition:
			transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1),
			z-index 0s;
	}

	.avatar:first-child {
		margin-left: 0;
	}

	/* only lift interactive avatars; static ones shouldn't reserve hover focus */
	a.avatar:hover,
	a.avatar:focus-visible,
	span.avatar.more:hover,
	span.avatar.more:focus-visible {
		transform: translateY(-2px) scale(1.08);
		z-index: 10;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.fallback {
		font-size: calc(var(--stack-size) * 0.42);
		font-weight: 600;
		color: var(--text-secondary);
		line-height: 1;
	}

	.more {
		background: var(--bg-secondary);
		font-size: calc(var(--stack-size) * 0.36);
		font-weight: 600;
		color: var(--text-tertiary);
		cursor: pointer;
		font-family: inherit;
	}

	a.more:hover,
	a.more:focus-visible,
	span.more:hover,
	span.more:focus-visible {
		color: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.avatar {
			transition: none;
		}
	}
</style>
