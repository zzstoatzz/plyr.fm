<script lang="ts">
  import { auth } from '$lib/auth';
  import UploadForm from './UploadForm.svelte';

  // one form for every track: who can listen is a choice inside it
  let { account, onlyYou }: { account: ReturnType<typeof auth.getAuth>; onlyYou: boolean } = $props();
</script>

<UploadForm {account} startOnlyYou={onlyYou} />
