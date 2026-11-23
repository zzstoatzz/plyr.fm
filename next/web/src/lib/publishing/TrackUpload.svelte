<script lang="ts">
  import { auth } from '$lib/auth';
  import UploadForm from './UploadForm.svelte';

  // one form for every track: who can listen is a choice inside it
  let { account, onlyYou, onAlbum }: { account: ReturnType<typeof auth.getAuth>; onlyYou: boolean; onAlbum?: (files: File[], cover?: File) => void } = $props();
</script>

<UploadForm {account} startOnlyYou={onlyYou} {onAlbum} />
