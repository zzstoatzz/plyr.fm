<script lang="ts">
	import { APP_NAME } from '$lib/branding';
	import type { PageData } from './$types';

	const FALLBACK_EMAIL = 'plyrdotfm@proton.me';

	let { data } = $props<{ data: PageData }>();

	const contactEmail = data.contactEmail || FALLBACK_EMAIL;
	const dmcaEmail = data.dmcaEmail || FALLBACK_EMAIL;
</script>

<svelte:head>
	<title>terms of service - {APP_NAME}</title>
	<meta name="description" content="Terms of Service for {APP_NAME}" />
</svelte:head>

<div class="legal-container">
	<article class="legal-content">
		<h1>terms of service</h1>
		<p class="last-updated">last updated: january 19, 2026</p>

		<p class="intro">
			these terms govern your use of {APP_NAME}, a music streaming platform built on the AT
			Protocol. by using the service, you agree to these terms.
		</p>

		<section>
			<h2>1. acceptance of terms</h2>
			<p>
				by accessing or using {APP_NAME}, you agree to be bound by these terms. if you disagree with
				any part, you may not use the service.
			</p>
		</section>

		<section>
			<h2>2. accounts</h2>
			<p>
				{APP_NAME} uses AT Protocol for authentication. your identity is your DID (decentralized identifier),
				not an account we control. we do not store passwords.
			</p>
			<p>
				we may terminate or suspend your access at any time, for any reason. termination removes
				your content from {APP_NAME} but does not affect your DID or data on your PDS—we don't control
				those.
			</p>
		</section>

		<section>
			<h2>3. content</h2>
			<p>
				you retain ownership of content you upload. by uploading, you grant us a non-exclusive,
				worldwide, royalty-free license to use, reproduce, modify, and distribute your content as
				necessary to provide the service.
			</p>
			<p>
				you represent that you own or have the necessary rights to the content you upload, and that
				it does not infringe any third party's rights.
			</p>
		</section>

		<section>
			<h2>4. acceptable use</h2>
			<p>you agree not to:</p>
			<ul>
				<li>violate any applicable laws</li>
				<li>infringe on others' rights</li>
				<li>upload content that is illegal or infringes copyright</li>
				<li>attempt unauthorized access to the service</li>
				<li>interfere with or disrupt the service</li>
			</ul>
		</section>

		<section>
			<h2>5. copyright & DMCA</h2>
			<p>we respond to valid DMCA takedown notices. our designated agent is:</p>
			<address class="dmca-agent">
				Nathan Nowack<br />
				DMCA Registration: {data.dmcaRegistrationNumber}<br />
				Email: <a href="mailto:{dmcaEmail}">{dmcaEmail}</a>
			</address>
			<p>we terminate accounts of repeat infringers.</p>
			<p>
				<strong>AT Protocol limitation:</strong> audio files are stored in public blob storage that {APP_NAME}
				controls and can remove at any time for policy violations. ATProto records referring to deleted
				audio files may persist in user personal data servers (which {APP_NAME} does not control), but
				{APP_NAME} will not provide access to violating or deleted content.
			</p>
		</section>

		<section>
			<h2>6. disclaimers</h2>
			<p>
				the service is provided "as is" and "as available" without warranties of any kind. we do not
				guarantee uptime or that the service will be error-free.
			</p>
			<p>
				we are not liable for any indirect, incidental, special, or consequential damages resulting
				from your use of the service.
			</p>
		</section>

		<section>
			<h2>7. changes</h2>
			<p>
				we may update these terms. material changes will be posted with notice. continued use after
				changes constitutes acceptance.
			</p>
		</section>

		<section class="contact">
			<h2>contact</h2>
			<p>
				questions? <a href="mailto:{contactEmail}">{contactEmail}</a>
			</p>
		</section>

		<nav class="legal-nav">
			<a href="/privacy">privacy policy</a>
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
