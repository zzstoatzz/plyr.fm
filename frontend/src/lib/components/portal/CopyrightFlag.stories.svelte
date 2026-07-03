<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CopyrightFlag from './CopyrightFlag.svelte';

	// the popover is the state that's painful to reproduce in the live portal
	// (needs a signed-in account with a copyright-flagged track). click the ⚠
	// glyph in each story to open it — the whole point of the harness.
	const { Story } = defineMeta({
		title: 'portal/CopyrightFlag',
		component: CopyrightFlag,
		parameters: { layout: 'centered' },
		argTypes: {
			match: { control: 'text' },
			recordUrl: { control: 'text' }
		}
	});
</script>

<!-- flagged with a matched recording + a link to the atproto record -->
<Story
	name="Match with record"
	args={{
		match: 'Love Story by Taylor Swift',
		recordUrl: 'https://pdsls.dev/at://did:plc:example/fm.plyr.track/abc'
	}}
/>

<!-- flagged, matched recording, but no atproto record url (record link hidden) -->
<Story name="Match without record" args={{ match: 'Bohemian Rhapsody by Queen', recordUrl: null }} />

<!-- scan flagged the track but produced no primary match string -->
<Story name="Flagged, no match string" args={{ match: null, recordUrl: null }} />
