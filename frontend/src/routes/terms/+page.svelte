<script lang="ts">
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	const FALLBACK_EMAIL = 'plyrdotfm@proton.me';

	let { data } = $props<{ data: PageData }>();

	const contactEmail = data.contactEmail || FALLBACK_EMAIL;
	const dmcaEmail = data.dmcaEmail || FALLBACK_EMAIL;
</script>

<svelte:head>
	<title>Terms of Service - {APP_NAME}</title>
	<meta name="description" content="Terms of Service for {APP_NAME}" />
</svelte:head>

<div class="legal-container">
	<article class="legal-content">
		<h1>Terms of Service</h1>
		<p class="last-updated">Last updated: February 4, 2026</p>

		<p class="intro">
			{APP_NAME} ("we", "us", or "our") is an audio streaming application built on the
			<a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>.
			These terms of service apply to the instance at
			<a href={APP_CANONICAL_URL}>{APP_CANONICAL_URL}</a> (the "site").
		</p>

		<p class="intro">
			{APP_NAME} is open source under the MIT license. Other instances or derivatives
			hosted elsewhere are not covered by these terms.
		</p>

		<p class="intro-secondary">
			By using the service, you agree to these terms. If you disagree with any part,
			you may not use the service.
		</p>

		<section>
			<h2>1. Accounts</h2>
			<p>
				{APP_NAME} uses the <a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>
				for authentication. Your identity is your DID (decentralized identifier), not an account we
				control. We do not store passwords.
			</p>
			<p>
				We may terminate or suspend your access at any time, for any reason. Termination removes or
				delists your content from {APP_NAME} and our storage, but does not affect your DID or data on
				your PDS—we don't control those.
			</p>
		</section>

		<section>
			<h2>2. Content</h2>
			<p>
				You retain ownership of content you upload. By uploading, you grant us a non-exclusive,
				worldwide, royalty-free license to use, reproduce, modify, and distribute your content
				(including copies stored on your PDS) as necessary to provide the service.
			</p>
			<p>
				You represent that you own or have the necessary rights to the content you upload, and that
				it does not infringe any third party's rights.
			</p>
		</section>

		<section>
			<h2>3. Acceptable Use</h2>
			<p>You agree not to:</p>
			<ul>
				<li>Violate any applicable laws</li>
				<li>Infringe on others' rights</li>
				<li>Upload content that is illegal or infringes copyright</li>
				<li>Attempt unauthorized access to the service</li>
				<li>Interfere with or disrupt the service</li>
			</ul>
		</section>

		<section>
			<h2>4. Copyright & DMCA</h2>
			<p>We respond to valid DMCA takedown notices. Our designated agent is:</p>
			<address class="dmca-agent">
				Nathan Nowack<br />
				DMCA Registration: {data.dmcaRegistrationNumber}<br />
				Email: <a href="mailto:{dmcaEmail}">{dmcaEmail}</a>
			</address>
			<p>We terminate accounts of repeat infringers.</p>
			<p>
				<strong><a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a> limitation:</strong>
				Audio may be stored on your PDS and/or in storage that {APP_NAME} controls for streaming. We can
				remove or delist content on {APP_NAME} and delete our copies for policy violations, but AT Protocol
				records and blobs stored on your PDS may persist and are not under our control.
			</p>
		</section>

		<section>
			<h2>5. Disclaimers</h2>
			<p>
				The service is provided "as is" and "as available" without warranties of any kind. We do not
				guarantee uptime or that the service will be error-free.
			</p>
			<p>
				We are not liable for any indirect, incidental, special, or consequential damages resulting
				from your use of the service.
			</p>
		</section>

		<section>
			<h2>6. Governing Law</h2>
			<p>
				These terms are governed by United States law, without regard to conflict-of-law provisions.
			</p>
		</section>

		<section>
			<h2>7. Changes</h2>
			<p>
				We may update these terms. Material changes will be posted with notice. Continued use after
				changes constitutes acceptance.
			</p>
		</section>

		<section class="contact">
			<h2>Contact</h2>
			<p>
				Questions? <a href="mailto:{contactEmail}">{contactEmail}</a>
			</p>
		</section>

		<nav class="legal-nav">
			<a href="/privacy">Privacy Policy</a>
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

	.dmca-agent {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 4px;
		padding: 1rem;
		font-style: normal;
		color: var(--text-secondary);
		margin: 1rem 0;
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
