<script lang="ts">
	import { onMount } from 'svelte';
	import { getServerConfig } from '$lib/config';

	interface Props {
		query: string;
		excludePatterns?: string[];
		includePatterns?: string[];
	}

	interface Bufo {
		id: string;
		url: string;
		name: string;
		score: number;
	}

	interface SpawnedBufo {
		id: string;
		url: string;
		style: string;
		animationClass: string;
	}

	let { query, excludePatterns = [], includePatterns = [] }: Props = $props();

	let bufos = $state<Bufo[]>([]);
	let spawnedBufos = $state<SpawnedBufo[]>([]);
	let spawnInterval: number | null = null;

	const CACHE_KEY_PREFIX = 'bufo-cache:';
	const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

	function getCached(key: string): Bufo[] | null {
		try {
			const raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
			if (!raw) return null;
			const { results, timestamp } = JSON.parse(raw);
			if (Date.now() - timestamp > CACHE_TTL_MS) {
				localStorage.removeItem(CACHE_KEY_PREFIX + key);
				return null;
			}
			return results;
		} catch {
			return null;
		}
	}

	function setCache(key: string, results: Bufo[]) {
		try {
			localStorage.setItem(
				CACHE_KEY_PREFIX + key,
				JSON.stringify({ results, timestamp: Date.now() })
			);
		} catch {
			// localStorage full or unavailable, ignore
		}
	}

	async function fetchBufos() {
		// check cache first
		const cached = getCached(query);
		if (cached) {
			bufos = cached;
			return;
		}

		try {
			// get patterns from props or config
			let exclude = excludePatterns;
			let include = includePatterns;
			if (exclude.length === 0 && include.length === 0) {
				const config = await getServerConfig();
				exclude = config.bufo_exclude_patterns ?? [];
				include = config.bufo_include_patterns ?? [];
			}

			const params = new URLSearchParams({
				query,
				top_k: '10',
				family_friendly: 'true'
			});
			if (exclude.length > 0) {
				params.set('exclude', exclude.join(','));
			}
			if (include.length > 0) {
				params.set('include', include.join(','));
			}
			const response = await fetch(`https://find-bufo.fly.dev/api/search?${params}`);
			if (response.ok) {
				const data = await response.json();
				bufos = data.results || [];
				if (bufos.length > 0) {
					setCache(query, bufos);
				}
			}
		} catch (e) {
			console.error('failed to fetch bufos:', e);
		}
	}

	function spawnBufo() {
		if (bufos.length === 0) return;

		const bufo = bufos[Math.floor(Math.random() * bufos.length)];
		const size = 60 + Math.random() * 80; // 60-140px
		const startY = Math.random() * 70 + 10; // 10-80% from top
		const duration = 8 + Math.random() * 8; // 8-16 seconds
		const delay = Math.random() * 0.5;
		const direction = Math.random() > 0.5 ? 'left' : 'right';
		const wobble = Math.random() > 0.5;

		const spawned: SpawnedBufo = {
			id: `${bufo.id}-${Date.now()}-${Math.random()}`,
			url: bufo.url,
			style: `
				--size: ${size}px;
				--start-y: ${startY}vh;
				--duration: ${duration}s;
				--delay: ${delay}s;
			`,
			animationClass: `float-${direction}${wobble ? ' wobble' : ''}`
		};

		spawnedBufos = [...spawnedBufos, spawned];

		// remove after animation completes
		setTimeout(() => {
			spawnedBufos = spawnedBufos.filter(b => b.id !== spawned.id);
		}, (duration + delay + 1) * 1000);
	}

	onMount(() => {
		fetchBufos().then(() => {
			// initial burst of toads
			for (let i = 0; i < 3; i++) {
				setTimeout(() => spawnBufo(), i * 800);
			}
			// then spawn periodically
			spawnInterval = window.setInterval(spawnBufo, 3000);
		});

		return () => {
			if (spawnInterval) window.clearInterval(spawnInterval);
		};
	});
</script>

<div class="bufo-container" aria-hidden="true">
	{#each spawnedBufos as bufo (bufo.id)}
		<img
			src={bufo.url}
			alt=""
			class="bufo {bufo.animationClass}"
			style={bufo.style}
		/>
	{/each}
</div>

<style>
	.bufo-container {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 1;
	}

	.bufo {
		position: absolute;
		width: var(--size);
		height: auto;
		top: var(--start-y);
		animation-duration: var(--duration);
		animation-delay: var(--delay);
		animation-timing-function: linear;
		animation-fill-mode: forwards;
		opacity: 0.9;
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
	}

	.float-left {
		right: -150px;
		animation-name: float-left;
	}

	.float-right {
		left: -150px;
		animation-name: float-right;
	}

	.wobble {
		animation-timing-function: ease-in-out;
	}

	@keyframes float-left {
		0% {
			transform: translateX(0) translateY(0) rotate(0deg);
			opacity: 0;
		}
		5% {
			opacity: 0.9;
		}
		95% {
			opacity: 0.9;
		}
		100% {
			transform: translateX(calc(-100vw - 200px)) translateY(20px) rotate(-10deg);
			opacity: 0;
		}
	}

	@keyframes float-right {
		0% {
			transform: translateX(0) translateY(0) rotate(0deg);
			opacity: 0;
		}
		5% {
			opacity: 0.9;
		}
		95% {
			opacity: 0.9;
		}
		100% {
			transform: translateX(calc(100vw + 200px)) translateY(20px) rotate(10deg);
			opacity: 0;
		}
	}

	/* add some vertical bounce for wobble variant */
	.wobble.float-left {
		animation-name: float-left-wobble;
	}

	.wobble.float-right {
		animation-name: float-right-wobble;
	}

	@keyframes float-left-wobble {
		0% {
			transform: translateX(0) translateY(0) rotate(0deg);
			opacity: 0;
		}
		5% {
			opacity: 0.9;
		}
		25% {
			transform: translateX(calc(-25vw - 50px)) translateY(-30px) rotate(-5deg);
		}
		50% {
			transform: translateX(calc(-50vw - 100px)) translateY(30px) rotate(5deg);
		}
		75% {
			transform: translateX(calc(-75vw - 150px)) translateY(-20px) rotate(-5deg);
		}
		95% {
			opacity: 0.9;
		}
		100% {
			transform: translateX(calc(-100vw - 200px)) translateY(10px) rotate(-10deg);
			opacity: 0;
		}
	}

	@keyframes float-right-wobble {
		0% {
			transform: translateX(0) translateY(0) rotate(0deg);
			opacity: 0;
		}
		5% {
			opacity: 0.9;
		}
		25% {
			transform: translateX(calc(25vw + 50px)) translateY(-30px) rotate(5deg);
		}
		50% {
			transform: translateX(calc(50vw + 100px)) translateY(30px) rotate(-5deg);
		}
		75% {
			transform: translateX(calc(75vw + 150px)) translateY(-20px) rotate(5deg);
		}
		95% {
			opacity: 0.9;
		}
		100% {
			transform: translateX(calc(100vw + 200px)) translateY(10px) rotate(10deg);
			opacity: 0;
		}
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.bufo {
			animation: none;
			opacity: 0;
		}
	}
</style>
