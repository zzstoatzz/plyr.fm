<script lang="ts">
	import { APP_NAME } from '$lib/branding';
</script>

<svelte:head>
	<title>cookie policy - {APP_NAME}</title>
	<meta name="description" content="Cookie Policy for {APP_NAME}" />
</svelte:head>

<div class="legal-container">
	<article class="legal-content">
		<h1>cookie policy</h1>
		<p class="last-updated">last updated: december 10, 2025</p>

		<p class="intro">
			{APP_NAME} uses minimal cookies. this policy explains what we use and why.
		</p>

		<section>
			<h2>essential cookies</h2>
			<p>we use only essential cookies required for the site to function:</p>
			<ul>
				<li>
					<strong>session cookie:</strong> stores your authentication state after logging
					in via AT Protocol OAuth. this is an HttpOnly, Secure cookie that cannot be
					accessed by JavaScript.
				</li>
			</ul>
			<p>
				without this cookie, you would need to log in again on every page. it expires
				when you log out or after your session times out.
			</p>
		</section>

		<section>
			<h2>what we don't use</h2>
			<p>{APP_NAME} does not use:</p>
			<ul>
				<li>advertising or tracking cookies</li>
				<li>third-party analytics cookies (no Google Analytics, etc.)</li>
				<li>social media tracking pixels</li>
				<li>cross-site tracking cookies</li>
			</ul>
		</section>

		<section>
			<h2>local storage</h2>
			<p>
				we also use browser local storage (not cookies) for preferences like theme,
				volume, and queue visibility. this data stays in your browser.
			</p>
			<p>
				see our <a href="/privacy">privacy policy</a> for details on what data we
				store on our servers.
			</p>
		</section>

		<section>
			<h2>third-party cookies</h2>
			<p>
				Cloudflare (our infrastructure provider) may set cookies for security purposes
				like bot detection. see
				<a href="https://www.cloudflare.com/cookie-policy/" target="_blank" rel="noopener">Cloudflare's cookie policy</a>
				for details.
			</p>
		</section>

		<section>
			<h2>managing cookies</h2>
			<p>
				you can disable cookies in your browser settings, but this will prevent you
				from logging in to {APP_NAME}. local storage preferences will still work.
			</p>
		</section>

		<section>
			<h2>changes to this policy</h2>
			<p>
				if we start using additional cookies, we'll update this page and note the
				change date above.
			</p>
		</section>

		<nav class="legal-nav">
			<a href="/privacy">privacy policy</a>
			<a href="/terms">terms of service</a>
		</nav>
	</article>
</div>

<style>
	.legal-container {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.legal-content {
		line-height: 1.7;
	}

	h1 {
		font-size: 2rem;
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
	}

	.last-updated {
		color: var(--text-tertiary);
		font-size: 0.9rem;
		margin: 0 0 2rem 0;
	}

	.intro {
		font-size: 1.1rem;
		color: var(--text-secondary);
		margin-bottom: 2rem;
	}

	section {
		margin-bottom: 2rem;
	}

	h2 {
		font-size: 1.25rem;
		margin: 0 0 1rem 0;
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
		margin-bottom: 0.5rem;
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

	.legal-nav {
		margin-top: 3rem;
		padding-top: 2rem;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		gap: 2rem;
	}

	.legal-nav a {
		color: var(--text-tertiary);
		font-size: 0.9rem;
	}

	.legal-nav a:hover {
		color: var(--accent);
	}
</style>
