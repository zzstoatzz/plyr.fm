<script lang="ts">
	import LegalPage from '$lib/legal/LegalPage.svelte';
</script>

<LegalPage title="Terms of Service" updated="November 23, 2026" other={{ route: '/(app)/privacy', label: 'privacy policy' }}>
	<p>
		plyr.fm ("we", "us", or "our") is an audio streaming app built on the <a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>.
		These terms apply to the instance at <a href="https://plyr.fm">plyr.fm</a> and its apps (the "service"). plyr.fm is open source under the MIT license;
		other instances or derivatives hosted elsewhere are not covered by these terms.
	</p>
	<p>By using the service, you agree to these terms. If you disagree with any part, you may not use the service.</p>

	<h2>1. Accounts</h2>
	<p>
		plyr.fm signs you in with your AT Protocol account. Your identity is your DID (decentralized identifier), not an account we control,
		and we never see or store your password.
	</p>
	<p>
		We may end or suspend your access at any time, for any reason. That removes or delists your content from plyr.fm and our storage,
		but does not affect your DID or the data on your PDS, which we don't control.
	</p>

	<h2>2. Content</h2>
	<p>
		You keep ownership of what you upload. By uploading, you grant us a non-exclusive, worldwide, royalty-free license to use, reproduce,
		modify, and distribute your content (including copies stored on your PDS) as needed to provide the service.
	</p>
	<p>
		Public audio is analyzed automatically to power features of the service, including audio embeddings for recommendations, genre
		suggestions, copyright fingerprinting, and aggregate views of the catalog such as the atlas. Data derived from that analysis (similarity
		coordinates, suggested genres, cluster labels) may be publicly visible.
	</p>
	<p>You represent that you own or have the rights to what you upload, and that it does not infringe anyone else's rights.</p>

	<h2>3. Acceptable use</h2>
	<p>You agree not to:</p>
	<ul>
		<li>violate any applicable law</li>
		<li>infringe on others' rights</li>
		<li>upload content that is illegal or infringes copyright</li>
		<li>attempt unauthorized access to the service</li>
		<li>interfere with or disrupt the service</li>
	</ul>

	<h2>4. Copyright and DMCA</h2>
	<p>We respond to valid DMCA takedown notices. Our designated agent is:</p>
	<address>
		Nathan Nowack<br />
		DMCA registration: DMCA-1069186 (<a href="https://dmca.copyright.gov/osp/" target="_blank" rel="noopener">U.S. Copyright Office directory</a>)<br />
		Email: <a href="mailto:dmca@plyr.fm">dmca@plyr.fm</a>
	</address>
	<p>We end the access of repeat infringers.</p>
	<p>
		<strong>An AT Protocol limit:</strong> audio may live on your PDS, in storage plyr.fm controls, or both. We can remove or delist content on
		plyr.fm and delete our copies for policy violations, but records and files on your PDS may persist and are not under our control.
	</p>

	<h2>5. Disclaimers</h2>
	<p>The service is provided "as is" and "as available" without warranties of any kind. We do not guarantee uptime or that the service is free of errors.</p>
	<p>We are not liable for any indirect, incidental, special, or consequential damages resulting from your use of the service.</p>

	<h2>6. Governing law</h2>
	<p>These terms are governed by United States law, without regard to conflict-of-law provisions.</p>

	<h2>7. Changes</h2>
	<p>We may update these terms. Material changes will be posted with notice. Continuing to use the service after a change means you accept it.</p>

	<h2>Contact</h2>
	<p>Questions? <a href="mailto:help@plyr.fm">help@plyr.fm</a></p>
</LegalPage>
