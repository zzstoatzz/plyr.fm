<script lang="ts">
	import { defaultPublishing } from '$lib/publishing';
	import { stashRecording, takeStashedRecording } from '$lib/record-stash';

	let publishing = $state(defaultPublishing());
	let result = $state('pending');

	async function save(): Promise<void> {
		publishing.access.downloads = 'off';
		const saved = await stashRecording({
			blob: new Blob(['recorded audio'], { type: 'audio/webm' }),
			title: 'recorded draft',
			tags: [],
			publishing: $state.snapshot(publishing),
			capturedDuration: 12
		});
		const restored = await takeStashedRecording();
		result =
			saved &&
			restored?.publishing.access.downloads === 'off' &&
			(await restored.blob.text()) === 'recorded audio'
				? 'draft restored'
				: 'draft lost';
	}
</script>

<button type="button" onclick={save}>save recording draft</button>
<p role="status">{result}</p>
