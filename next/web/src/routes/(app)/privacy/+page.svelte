<script lang="ts">
	import LegalPage from '$lib/legal/LegalPage.svelte';
</script>

<LegalPage title="Privacy Policy" updated="November 23, 2026" other={{ route: '/(app)/terms', label: 'terms of service' }}>
	<p>
		plyr.fm ("we", "us", or "our") is an audio streaming app built on the <a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>.
		This policy applies to the instance at <a href="https://plyr.fm">plyr.fm</a> and its apps. plyr.fm is open source under the MIT license;
		other instances or derivatives hosted elsewhere are not covered by this policy.
	</p>
	<p>It explains what we collect, what is public by design on the AT Protocol, and your rights.</p>

	<h2>1. The AT Protocol</h2>
	<p>
		<strong>Public by design:</strong> your DID, handle, profile, tracks, likes, comments, and playlists are records on your PDS (Personal Data
		Server). The AT Protocol is a public data protocol, so any AT Protocol app can read them, not just plyr.fm.
	</p>
	<p>
		<strong>Your PDS:</strong> plyr.fm does not run a PDS. We write records to wherever your account is hosted (for example bsky.social or a
		self-hosted PDS), and that host's privacy policy governs the data there.
	</p>
	<p>
		<strong>Private data:</strong> sign-in tokens stay on your device. Your settings, tracks you keep private, play counts, and server logs are
		stored on our servers.
	</p>

	<h2>2. Data we collect</h2>
	<p><strong>You provide:</strong> your AT Protocol identity when you sign in, the audio, artwork and details you upload, and settings such as your accent color.</p>
	<p>
		<strong>Automatically:</strong> plays, and the browser and app information that comes with every request. When you listen signed out, one
		cookie with a random id counts your plays once; it is not tied to who you are.
	</p>
	<p>
		<strong>We do not store your IP address.</strong> Our hosting and CDN providers see it in order to route your request, as any web service's
		do, but plyr.fm writes it to neither our database nor our logs.
	</p>

	<h2>3. How we use it</h2>
	<p>We use your data to run the service and improve it. We do not sell your data or use it for advertising.</p>
	<p>
		Public audio is analyzed automatically: audio embeddings for recommendations and the atlas, genre suggestions, and copyright fingerprinting.
		Data derived from that analysis (similarity coordinates, suggested genres, cluster labels) powers public features.
	</p>

	<h2>4. Third parties</h2>
	<p>We use:</p>
	<ul>
		<li><strong><a href="https://cloudflare.com" target="_blank" rel="noopener">Cloudflare</a></strong>: CDN, storage (R2), and email forwarding for our contact addresses</li>
		<li><strong><a href="https://fly.io" target="_blank" rel="noopener">Fly.io</a></strong>: server hosting</li>
		<li><strong><a href="https://neon.tech" target="_blank" rel="noopener">Neon</a></strong>: database</li>
		<li><strong><a href="https://logfire.pydantic.dev" target="_blank" rel="noopener">Logfire</a></strong>: error monitoring</li>
		<li><strong><a href="https://audd.io" target="_blank" rel="noopener">AudD</a></strong>: audio fingerprinting for copyright detection</li>
		<li><strong><a href="https://anthropic.com" target="_blank" rel="noopener">Anthropic</a></strong>: image checks for content moderation, and names for regions of the atlas</li>
		<li><strong><a href="https://modal.com" target="_blank" rel="noopener">Modal</a></strong>: audio embeddings</li>
		<li><strong><a href="https://replicate.com" target="_blank" rel="noopener">Replicate</a></strong>: genre suggestions</li>
	</ul>
	<p>
		When you turn them on, we may also write records to your PDS in other apps' namespaces (for example
		<a href="https://teal.fm" target="_blank" rel="noopener">teal.fm</a> for scrobbling).
	</p>

	<h2>5. Your rights</h2>
	<p>
		You can change or delete your tracks, albums, playlists and settings in the app. To have everything plyr.fm holds about you removed, email
		<a href="mailto:help@plyr.fm">help@plyr.fm</a> and we will delete your files from our storage and your data from our database.
	</p>
	<p><strong>We cannot delete:</strong> your DID (you control it), data on other AT Protocol servers, or records in other people's PDSes.</p>

	<h2>6. Security</h2>
	<p>
		We use HTTPS everywhere and never handle your password. No system is perfectly secure; please report vulnerabilities to
		<a href="mailto:help@plyr.fm">help@plyr.fm</a>.
	</p>

	<h2>7. Children</h2>
	<p>plyr.fm is not for children under 13. We do not knowingly collect data from children.</p>

	<h2>8. Changes</h2>
	<p>We may update this policy. Material changes will be posted with notice.</p>

	<h2>Contact</h2>
	<p>Questions? <a href="mailto:help@plyr.fm">help@plyr.fm</a></p>
</LegalPage>
