<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AudioPreview from './AudioPreview.svelte';
	import { StagedTransfer, type StagedTransport } from '$lib/staged-transfer.svelte';
	import { UploadPartError, type UploadSessionState } from '$lib/upload-session';
	import { __testing } from '$lib/audio/wav';

	// a real, playable file: two seconds of 440 Hz, encoded on the spot so the
	// stories carry no binary fixture.
	function tone(): File {
		const sampleRate = 8000;
		const frames = sampleRate * 2;
		const samples = Float32Array.from(
			{ length: frames },
			(_, i) => Math.sin((2 * Math.PI * 440 * i) / sampleRate) * (1 - i / frames)
		);
		const buffer: AudioBuffer = {
			numberOfChannels: 1,
			length: frames,
			sampleRate,
			duration: frames / sampleRate,
			getChannelData: () => samples,
			copyFromChannel: (destination, _ch, start = 0) =>
				destination.set(samples.subarray(start, start + destination.length)),
			copyToChannel: (source, _ch, start = 0) => samples.set(source, start)
		};
		return new File([__testing.encodeWav(buffer)], 'tone.wav', { type: 'audio/wav' });
	}

	const session: UploadSessionState = {
		upload_id: 'story',
		part_size_bytes: 1024,
		part_count: 4,
		received_parts: []
	};

	// transports that park the transfer in one state so each story is stable.
	function stuckAt(loaded: number): StagedTransport {
		return {
			start: async () => session,
			resume: async () => session,
			parts: ({ onProgress }) => {
				onProgress(loaded, 4096);
				return new Promise(() => {});
			}
		};
	}
	const done: StagedTransport = {
		start: async () => session,
		resume: async () => session,
		parts: async ({ onProgress }) => onProgress(4096, 4096)
	};
	const broken: StagedTransport = {
		start: async () => session,
		resume: async () => session,
		parts: async ({ onProgress }) => {
			onProgress(1536, 4096);
			throw new UploadPartError(2, { kind: 'network' });
		}
	};
	const describe = () => 'upload failed (failed at 37%): connection was interrupted';

	const { Story } = defineMeta({
		title: 'upload/AudioPreview',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Chosen file, no transfer">
	<AudioPreview source={tone()} />
</Story>

<Story name="Transferring">
	<AudioPreview source={tone()} transfer={new StagedTransfer(tone(), stuckAt(2560), describe)} />
</Story>

<Story name="Received">
	<AudioPreview source={tone()} transfer={new StagedTransfer(tone(), done, describe)} />
</Story>

<Story name="Failed with retry">
	<AudioPreview source={tone()} transfer={new StagedTransfer(tone(), broken, describe)} />
</Story>

<Story name="Recording with a fallback length">
	<AudioPreview
		source={new Blob([tone()], { type: 'audio/webm' })}
		name="voice memo"
		fallbackDurationSeconds={2}
	/>
</Story>
