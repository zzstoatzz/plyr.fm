<script lang="ts">
	/**
	 * renders text with auto-linked URLs and markdown-style links.
	 *
	 * supports:
	 * - bare URLs: https://example.com -> clickable link
	 * - markdown links: [text](https://example.com) -> "text" as clickable link
	 * - domain/path URLs: github.com/user/repo -> clickable link
	 */

	interface Props {
		text: string;
		class?: string;
	}

	let { text, class: className }: Props = $props();

	interface TextPart {
		type: 'text' | 'link';
		content: string;
		href?: string;
	}

	function parseText(input: string): TextPart[] {
		const parts: TextPart[] = [];

		// combined regex: markdown links OR bare URLs OR domain/path
		// markdown: [text](url)
		// bare URL: https?://... or www....
		// domain/path: github.com/... (must have path to avoid false positives)
		const combinedRegex =
			/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>)\]]+|www\.[^\s<>)\]]+|[a-z0-9][-a-z0-9]*\.[a-z]{2,}\/[^\s<>)\]]+)/gi;

		let lastIndex = 0;
		let match;

		while ((match = combinedRegex.exec(input)) !== null) {
			// add text before match
			if (match.index > lastIndex) {
				parts.push({
					type: 'text',
					content: input.slice(lastIndex, match.index)
				});
			}

			if (match[1] && match[2]) {
				// markdown link: [text](url)
				parts.push({
					type: 'link',
					content: match[1],
					href: match[2]
				});
			} else if (match[3]) {
				// bare URL or domain/path
				let href = match[3];
				if (!href.startsWith('http://') && !href.startsWith('https://')) {
					href = 'https://' + href;
				}
				parts.push({
					type: 'link',
					content: match[3],
					href
				});
			}

			lastIndex = match.index + match[0].length;
		}

		// add remaining text
		if (lastIndex < input.length) {
			parts.push({
				type: 'text',
				content: input.slice(lastIndex)
			});
		}

		return parts;
	}

	const parsed = $derived(parseText(text));
</script>

<span class={className}
	>{#each parsed as part, i (i)}{#if part.type === 'link'}<a
				href={part.href}
				target="_blank"
				rel="noopener noreferrer"
				class="rich-text-link">{part.content}</a
			>{:else}{part.content}{/if}{/each}</span
>

<style>
	.rich-text-link {
		color: var(--accent);
		text-decoration: none;
		word-break: break-all;
	}

	.rich-text-link:hover {
		text-decoration: underline;
	}
</style>
