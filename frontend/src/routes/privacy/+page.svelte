<script lang="ts">
	import { APP_NAME } from '$lib/branding';
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();
</script>

<svelte:head>
	<title>privacy policy - {APP_NAME}</title>
	<meta name="description" content="Privacy Policy for {APP_NAME}" />
</svelte:head>

<div class="legal-container">
	<article class="legal-content">
		<h1>privacy policy</h1>
		<p class="last-updated">last updated: december 10, 2025</p>

		<p class="intro">
			{APP_NAME} is built on the AT Protocol, which fundamentally changes how user data works.
			this policy explains what data we collect, what's public by design, and your rights.
		</p>

		<p class="open-source-notice">
			{APP_NAME} is open source under the MIT license. source code is available at
			<a href="https://github.com/zzstoatzz/plyr.fm" target="_blank" rel="noopener">github.com/zzstoatzz/plyr.fm</a>.
			this policy applies only to the instance at <a href="https://plyr.fm">plyr.fm</a> —
			other instances or forks are not covered.
		</p>

		<nav class="toc">
			<h2>contents</h2>
			<ol>
				<li><a href="#atproto">the AT Protocol difference</a></li>
				<li><a href="#data-collected">data we collect</a></li>
				<li><a href="#data-use">how we use your data</a></li>
				<li><a href="#third-parties">third-party services</a></li>
				<li><a href="#your-rights">your rights</a></li>
				<li><a href="#security">security</a></li>
				<li><a href="#tracking">tracking and do not track</a></li>
				<li><a href="#indexed-data">indexed data and external content</a></li>
				<li><a href="#children">children's privacy</a></li>
				<li><a href="#international">international transfers</a></li>
				<li><a href="#changes">changes to this policy</a></li>
				<li><a href="#contact">contact us</a></li>
			</ol>
		</nav>

		<section id="atproto">
			<h2>1. the AT Protocol difference</h2>
			<p>
				unlike traditional platforms, {APP_NAME} uses the
				<a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a> (ATProto)
				for identity and social features. this has important privacy implications:
			</p>

			<h3>public protocol data</h3>
			<p>
				the following data is <strong>public by design</strong> and stored on the decentralized
				AT Protocol network, not exclusively on our servers:
			</p>
			<ul>
				<li>your <a href="https://atproto.com/guides/glossary#did" target="_blank" rel="noopener">DID</a> (Decentralized Identifier) - your permanent, portable identity</li>
				<li>your <a href="https://atproto.com/guides/glossary#handle" target="_blank" rel="noopener">handle</a> (e.g., yourname.bsky.social)</li>
				<li>your profile information (display name, avatar, bio)</li>
				<li>tracks you upload (metadata published to your PDS)</li>
				<li>likes, comments, and other social interactions</li>
				<li>scrobbles (if <a href="https://teal.fm" target="_blank" rel="noopener">teal.fm</a> integration is enabled)</li>
			</ul>
			<p>
				<strong>important:</strong> this data is visible to anyone on the AT Protocol network,
				not just {APP_NAME} users. other ATProto clients can read this data.
			</p>

			<h3>OAuth scopes we request</h3>
			<p>
				when you log in, we request permission to read and write the following record types
				on your <a href="https://atproto.com/guides/glossary#pds-personal-data-server">PDS</a>:
			</p>
			<ul>
				<li><code>fm.plyr.feed.track</code> - your uploaded tracks</li>
				<li><code>fm.plyr.feed.like</code> - your likes</li>
				<li><code>fm.plyr.feed.comment</code> - your comments</li>
				<li><code>fm.plyr.feed.list</code> - your playlists and albums</li>
				<li><code>fm.plyr.actor.profile</code> - your artist profile</li>
			</ul>
			<p>
				we can create, update, and delete these records on your behalf. when you delete
				content through {APP_NAME}, we delete it from your PDS. however, copies may persist
				on <a href="https://atproto.com/guides/glossary#relay">relay servers</a> that have
				already indexed your data - {APP_NAME} cannot control third-party relays.
			</p>

			<h3>private platform data</h3>
			<p>
				the following data is stored <strong>only on {APP_NAME}'s servers</strong> and is
				not published to the AT Protocol network:
			</p>
			<ul>
				<li>session tokens and authentication state</li>
				<li>your preferences and some settings</li>
				<li>server logs and analytics</li>
			</ul>
		</section>

		<section id="data-collected">
			<h2>2. data we collect</h2>

			<h3>2.1 information you provide</h3>
			<ul>
				<li><strong>AT Protocol identity:</strong> your DID and handle when you authenticate</li>
				<li><strong>profile data:</strong> display name, avatar, bio (synced from your ATProto profile)</li>
				<li><strong>content:</strong> audio files, artwork, and metadata you upload</li>
				<li><strong>preferences:</strong> accent color, hidden tags, playback settings (stored on our servers to sync across devices)</li>
			</ul>

			<h3>2.2 information collected automatically</h3>
			<ul>
				<li><strong>usage data:</strong> play counts, listening history, search queries</li>
				<li><strong>device info:</strong> browser type, operating system, device identifiers</li>
				<li><strong>log data:</strong> IP addresses, access times, pages viewed, errors</li>
				<li><strong>cookies:</strong> session cookies for authentication (HttpOnly, secure)</li>
			</ul>

			<h3>2.3 information from third parties</h3>
			<ul>
				<li><strong>AT Protocol:</strong> your public profile data from your PDS</li>
			</ul>
		</section>

		<section id="data-use">
			<h2>3. how we use your data</h2>
			<p>we use your information to:</p>
			<ul>
				<li>provide and improve the Service</li>
				<li>authenticate you and maintain your session</li>
				<li>personalize your experience (recommendations, preferences)</li>
				<li>detect and prevent fraud, abuse, and policy violations</li>
				<li>comply with legal obligations</li>
				<li>analyze usage patterns to improve the platform</li>
			</ul>

			<h3>we do not:</h3>
			<ul>
				<li>sell your personal data to third parties</li>
				<li>use your data for targeted advertising</li>
				<li>share your listening history with other users (unless you choose to)</li>
				<li>train AI models on your content without permission</li>
			</ul>
		</section>

		<section id="third-parties">
			<h2>4. third-party services</h2>
			<p>we share data with the following service providers:</p>

			<h3>4.1 <a href="https://www.cloudflare.com" target="_blank" rel="noopener">Cloudflare</a> (infrastructure)</h3>
			<p>
				Cloudflare provides CDN, DDoS protection, and storage (R2) for audio files and
				images. they may collect IP addresses and access logs.
			</p>
			<p>
				Cloudflare's privacy policy:
				<a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">cloudflare.com/privacypolicy</a>
			</p>

			<h3>4.2 <a href="https://fly.io" target="_blank" rel="noopener">Fly.io</a> (hosting)</h3>
			<p>
				our backend runs on Fly.io. they may process server logs and request metadata.
			</p>

			<h3>4.3 <a href="https://neon.tech" target="_blank" rel="noopener">Neon</a> (database)</h3>
			<p>
				our database is hosted on Neon's PostgreSQL service. your private platform data
				is stored there.
			</p>

			<h3>4.4 <a href="https://pydantic.dev/logfire" target="_blank" rel="noopener">Pydantic Logfire</a> (observability)</h3>
			<p>
				we use Logfire for application monitoring and debugging. logs may contain request
				metadata but are stripped of sensitive personal information.
			</p>

			<h3>4.5 AT Protocol network</h3>
			<p>
				public data is shared with the AT Protocol network, including relay servers and
				other clients that subscribe to your PDS.
			</p>
		</section>

		<section id="your-rights">
			<h2>5. your rights</h2>

			<h3>5.1 for all users</h3>
			<ul>
				<li><strong>access:</strong> you can view your data in your account settings</li>
				<li><strong>correction:</strong> update your profile via your ATProto PDS</li>
				<li><strong>deletion:</strong> delete your {APP_NAME} account through settings</li>
				<li><strong>portability:</strong> your ATProto data is inherently portable</li>
			</ul>

			<h3>5.2 deletion limitations</h3>
			<p>
				<strong>important:</strong> when you delete your {APP_NAME} account, we remove:
			</p>
			<ul>
				<li>your audio files and images from our storage (R2)</li>
				<li>your sessions, preferences, and private data from our database</li>
				<li>your content from the {APP_NAME} interface</li>
			</ul>
			<p>we <strong>cannot</strong> delete:</p>
			<ul>
				<li>your DID or ATProto identity (you control this)</li>
				<li>data that has propagated to other ATProto servers</li>
				<li>records in other users' PDSes (e.g., if they liked your track)</li>
				<li>cached copies that may exist temporarily on CDNs</li>
			</ul>

			<h3>5.3 for EU/EEA users (GDPR)</h3>
			<p>under the General Data Protection Regulation, you have additional rights:</p>
			<ul>
				<li><strong>right to be forgotten:</strong> we delete from our servers and your PDS, but cannot control third-party relays</li>
				<li><strong>right to object:</strong> to processing based on legitimate interests</li>
				<li><strong>right to restrict:</strong> processing in certain circumstances</li>
				<li><strong>right to complain:</strong> to your local data protection authority</li>
			</ul>
			<p>
				legal basis for processing: contract performance (providing the service), legitimate
				interests (security, fraud prevention), and consent (optional features).
			</p>

			<h3>5.4 for California users (CCPA)</h3>
			<p>under the California Consumer Privacy Act, you have the right to:</p>
			<ul>
				<li>know what personal information we collect</li>
				<li>delete your personal information</li>
				<li>opt-out of the sale of personal information (we don't sell data)</li>
				<li>non-discrimination for exercising your rights</li>
			</ul>
		</section>

		<section id="security">
			<h2>6. security</h2>
			<p>we protect your data with:</p>
			<ul>
				<li>encryption in transit (HTTPS/TLS)</li>
				<li>encryption at rest for sensitive data (OAuth tokens, session data)</li>
				<li>HttpOnly, Secure cookies for authentication</li>
				<li>regular security reviews and dependency updates</li>
			</ul>
			<p>
				no system is 100% secure. if you discover a vulnerability, please report it to
				<a href="mailto:{data.contactEmail}">{data.contactEmail}</a>.
			</p>
		</section>

		<section id="tracking">
			<h2>7. tracking and do not track</h2>
			<p>
				{APP_NAME} does not use third-party analytics (like Google Analytics), advertising
				trackers, or behavioral profiling. we use only essential cookies for authentication.
			</p>
			<p>
				we honor Do Not Track (DNT) browser signals by default — because we have no
				first-party tracking to disable.
			</p>
			<p>
				<strong>infrastructure providers:</strong> Cloudflare (our CDN/hosting) may collect
				IP addresses and request metadata for security and performance purposes. this is
				standard infrastructure logging, not behavioral tracking. see
				<a href="#third-parties">section 4</a> for details.
			</p>
			<p>
				<strong>operational monitoring:</strong> we use
				<a href="https://pydantic.dev/logfire" target="_blank" rel="noopener">Logfire</a>
				for error tracking and performance monitoring. this data is used for debugging
				and is not linked to individual users or used for profiling.
			</p>
		</section>

		<section id="indexed-data">
			<h2>8. indexed data and external content</h2>
			<p>
				{APP_NAME} indexes and displays content from ATProtocol PDS instances operated by
				third parties. we are not the source of truth for this data — your PDS is.
			</p>
			<p>
				while we index content from external PDSs, we may apply moderation to what we
				display. this includes:
			</p>
			<ul>
				<li>blurring images flagged as sensitive or explicit</li>
				<li>hiding or removing content subject to valid <a href="/terms#dmca">DMCA takedown requests</a></li>
				<li>removing content that violates our <a href="/terms#content-policy">content policy</a></li>
			</ul>
			<p>
				moderation applies only to how content appears on {APP_NAME} — we cannot modify
				or delete the underlying records on third-party PDSs. we also cannot guarantee
				the accuracy or appropriateness of content we haven't yet reviewed.
			</p>
			<p>
				<strong>protocol transparency:</strong> ATProtocol is a public data protocol.
				there is no built-in privacy mechanism for hiding public records (tracks, likes,
				comments). {APP_NAME} reflects this architecture and cannot offer private storage
				for protocol data.
			</p>
		</section>

		<section id="children">
			<h2>9. children's privacy</h2>
			<p>
				{APP_NAME} is not intended for children under 13 (or 16 in the EU). we do not
				knowingly collect data from children. if you believe a child has provided us
				personal information, contact us and we will delete it.
			</p>
		</section>

		<section id="international">
			<h2>10. international transfers</h2>
			<p>
				{APP_NAME} is operated from the United States. your data may be transferred to
				and processed in the US and other countries where our service providers operate.
			</p>
			<p>
				for EU users: we rely on Standard Contractual Clauses and service provider
				certifications for lawful international transfers.
			</p>
		</section>

		<section id="changes">
			<h2>11. changes to this policy</h2>
			<p>
				we may update this policy from time to time. material changes will be announced
				via the Service with at least 30 days' notice. continued use after changes take
				effect constitutes acceptance.
			</p>
		</section>

		<section id="contact" class="contact">
			<h2>12. contact us</h2>
			<p>for privacy questions or to exercise your rights:</p>
			<address>
				Email: <a href="mailto:{data.privacyEmail}">{data.privacyEmail}</a>
			</address>
			<p class="response-time">we aim to respond to all requests within 30 days.</p>
		</section>

		<nav class="legal-nav">
			<a href="/terms">terms of service</a>
			<a href="/cookies">cookie policy</a>
		</nav>
	</article>
</div>

<style>
	.legal-container {
		max-width: 800px;
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
		margin-bottom: 1rem;
	}

	.open-source-notice {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		padding: 1rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		margin-bottom: 2rem;
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.toc {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 3rem;
	}

	.toc h2 {
		font-size: 1rem;
		margin: 0 0 1rem 0;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	.toc ol {
		margin: 0;
		padding-left: 1.5rem;
	}

	.toc li {
		margin-bottom: 0.5rem;
	}

	.toc a {
		color: var(--accent);
		text-decoration: none;
	}

	.toc a:hover {
		text-decoration: underline;
	}

	section {
		margin-bottom: 3rem;
	}

	h2 {
		font-size: 1.3rem;
		margin: 0 0 1rem 0;
		color: var(--text-primary);
		padding-top: 1rem;
		border-top: 1px solid var(--border-subtle);
	}

	h3 {
		font-size: 1.1rem;
		margin: 1.5rem 0 0.75rem 0;
		color: var(--text-primary);
	}

	p {
		margin: 0 0 1rem 0;
		color: var(--text-secondary);
	}

	ul, ol {
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

	address {
		font-style: normal;
		margin: 1rem 0;
	}

	.contact {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1.5rem;
	}

	.contact h2 {
		border-top: none;
		padding-top: 0;
		margin-top: 0;
	}

	.response-time {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-tertiary);
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

	@media (max-width: 600px) {
		.legal-container {
			padding: 1.5rem 1rem 6rem;
		}

		h1 {
			font-size: 1.5rem;
		}

		h2 {
			font-size: 1.15rem;
		}

		h3 {
			font-size: 1rem;
		}
	}
</style>
