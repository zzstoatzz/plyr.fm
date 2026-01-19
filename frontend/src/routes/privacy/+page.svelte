<script lang="ts">
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	const FALLBACK_EMAIL = 'plyrdotfm@proton.me';

	let { data } = $props<{ data: PageData }>();

	const privacyEmail = data.privacyEmail || FALLBACK_EMAIL;
	const contactEmail = data.contactEmail || FALLBACK_EMAIL;
</script>

<svelte:head>
	<title>privacy policy - {APP_NAME}</title>
	<meta name="description" content="Privacy Policy for {APP_NAME}" />
</svelte:head>

<div class="legal-container">
	<article class="legal-content">
		<h1>privacy policy</h1>
		<p class="last-updated">last updated: january 19, 2026</p>

		<p class="intro">
			{APP_NAME} ("we", "us", or "our") is a music streaming application built on the
			<a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>.
			this privacy policy applies to the instance at
			<a href={APP_CANONICAL_URL}>{APP_CANONICAL_URL}</a> (the "site").
		</p>

		<p class="intro">
			{APP_NAME} is open source under the MIT license. other instances or derivatives
			hosted elsewhere are not covered by this policy.
		</p>

		<p class="intro-secondary">
			this policy explains what data we collect, what's public by design on the
			<a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>,
			and your rights.
		</p>

		<section>
			<h2>1. the AT Protocol</h2>
			<p>
				{APP_NAME} uses the <a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>
				for identity and social features. this has important implications:
			</p>
			<p>
				<strong>public by design:</strong> your DID, handle, profile, tracks, likes, comments,
				and playlists are stored on your PDS (Personal Data Server) and remain under your
				control. the AT Protocol is a public data protocol—this data is accessible to any
				AT Protocol application, not just {APP_NAME}.
			</p>
			<p>
				<strong>your PDS:</strong> {APP_NAME} does not operate a PDS—we write records to
				wherever your account is hosted (e.g., bsky.social or a self-hosted PDS). we do not
				control that data; their privacy policies govern it.
			</p>
			<p>
				<strong>private data:</strong> session tokens, preferences, and server logs are stored
				only on our servers.
			</p>
		</section>

		<section>
			<h2>2. data we collect</h2>
			<p><strong>you provide:</strong> your AT Protocol identity when you log in, audio files
				and metadata you upload, and preferences like accent color.</p>
			<p><strong>automatically:</strong> play counts, IP addresses, browser info, and
				session cookies for authentication.</p>
		</section>

		<section>
			<h2>3. how we use it</h2>
			<p>we use your data to provide the service, maintain your session, and improve the
				platform. we do not sell your data or use it for advertising.</p>
		</section>

		<section>
			<h2>4. third parties</h2>
			<p>we use:</p>
			<ul>
				<li><strong><a href="https://cloudflare.com" target="_blank" rel="noopener">Cloudflare</a></strong> - CDN, storage (R2)</li>
				<li><strong><a href="https://fly.io" target="_blank" rel="noopener">Fly.io</a></strong> - backend hosting</li>
				<li><strong><a href="https://neon.tech" target="_blank" rel="noopener">Neon</a></strong> - database</li>
				<li><strong><a href="https://logfire.pydantic.dev" target="_blank" rel="noopener">Logfire</a></strong> - error monitoring</li>
				<li><strong><a href="https://audd.io" target="_blank" rel="noopener">AudD</a></strong> - audio fingerprinting for copyright detection</li>
				<li><strong><a href="https://anthropic.com" target="_blank" rel="noopener">Anthropic</a></strong> - image analysis for content moderation</li>
			</ul>
		</section>

		<section>
			<h2>5. your rights</h2>
			<p>you can access, correct, or delete your data through settings. when you delete your
				account, we remove your files from our storage and your data from our database.</p>
			<p>
				<strong>we cannot delete:</strong> your DID (you control it), data on other AT Protocol
				servers, or records in other users' PDSes.
			</p>
		</section>

		<section>
			<h2>6. security</h2>
			<p>we use HTTPS, encrypt sensitive data, and use HttpOnly cookies. no system is
				perfectly secure—report vulnerabilities to
				<a href="mailto:{contactEmail}">{contactEmail}</a>.</p>
		</section>

		<section>
			<h2>7. children</h2>
			<p>{APP_NAME} is not for children under 13. we do not knowingly collect data from
				children.</p>
		</section>

		<section>
			<h2>8. changes</h2>
			<p>we may update this policy. material changes will be posted with notice.</p>
		</section>

		<section class="contact">
			<h2>contact</h2>
			<p>
				questions? <a href="mailto:{privacyEmail}">{privacyEmail}</a>
			</p>
		</section>

		<nav class="legal-nav">
			<a href="/terms">terms of service</a>
		</nav>
	</article>
</div>

<style>
	.legal-container {
		max-width: 700px;
		margin: 0 auto;
		padding: 2rem 1.5rem 6rem;
	}

	.legal-content {
		color: var(--text-primary);
		line-height: 1.7;
	}

	h1 {
		font-size: 2rem;
		margin: 0 0 0.5rem 0;
	}

	.last-updated {
		color: var(--text-tertiary);
		font-size: 0.9rem;
		margin: 0 0 2rem 0;
	}

	.intro {
		font-size: 1.05rem;
		color: var(--text-secondary);
		margin-bottom: 1rem;
	}

	.intro-secondary {
		font-size: 1.05rem;
		color: var(--text-secondary);
		margin-bottom: 2rem;
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	section {
		margin-bottom: 2rem;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem 0;
		color: var(--text-primary);
	}

	p {
		margin: 0 0 1rem 0;
		color: var(--text-secondary);
	}

	ul {
		margin: 0 0 1rem 0;
		padding-left: 1.5rem;
		color: var(--text-secondary);
	}

	li {
		margin-bottom: 0.4rem;
	}

	strong {
		color: var(--text-primary);
	}

	a {
		color: var(--accent);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	.contact {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1.5rem;
		margin-top: 2rem;
	}

	.contact h2 {
		margin-top: 0;
	}

	.contact p {
		margin: 0;
	}

	.legal-nav {
		margin-top: 2rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	.legal-nav a {
		color: var(--text-tertiary);
		font-size: 0.9rem;
	}

	.legal-nav a:hover {
		color: var(--accent);
	}

	@media (max-width: 600px) {
		.legal-container {
			padding: 1.5rem 1rem 6rem;
		}

		h1 {
			font-size: 1.5rem;
		}
	}
</style>
