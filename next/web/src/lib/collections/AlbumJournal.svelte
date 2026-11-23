<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import CollectionJournal from './CollectionJournal.svelte';
  import { collectionJournal } from './CollectionJournal.svelte.ts';

  // an album that didn't finish saving shows wherever a new album starts
  let { account }: { account: ReturnType<typeof auth.getAuth> } = $props();
  const pds = untrack(() => createPds(account));
  let live = false;
  const journal = collectionJournal(pds, () => live && auth.getAuth().rpc === account.rpc);
  onMount(() => { live = true; void journal.refresh(); return () => { live = false; }; });
</script>

<CollectionJournal {...journal.view} {pds} refresh={journal.refresh} />
