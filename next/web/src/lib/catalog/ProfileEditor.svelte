<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { AwaitStatus } from '$core/api';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import Loading from '$lib/ui/Loading.svelte';
  import EditorPanel from './EditorPanel.svelte';

  let { account }: { account: ReturnType<typeof auth.getAuth> } = $props();
  const pds = untrack(() => createPds(account));
  type Profile = Awaited<ReturnType<typeof pds.myProfile>>;

  let profile = $state.raw<Profile>();
  let bio = $state('');
  let avatar = $state('');
  let loading = $state(true);
  let readError = $state('');
  let writeError = $state('');
  let busy = $state(false);
  let saved = $state<AwaitStatus>();
  let latestRead = $state(false);
  let live = false;

  const current = () => live && auth.getAuth().rpc === account.rpc;
  let changed = $derived(bio.trim() !== (profile?.value?.bio ?? '') || avatar.trim() !== (profile?.value?.avatar ?? ''));

  onMount(() => {
    live = true;
    void load();
    return () => { live = false; };
  });

  async function load() {
    readError = '';
    loading = true;
    latestRead = false;
    try {
      const result = await pds.myProfile();
      if (!current()) return;
      profile = result;
      bio = typeof result.value?.bio === 'string' ? result.value.bio : '';
      avatar = typeof result.value?.avatar === 'string' ? result.value.avatar : '';
      latestRead = true;
    } catch (failure) {
      if (current()) readError = failure instanceof Error ? failure.message : 'could not load your profile.';
    } finally { if (current()) loading = false; }
  }

  function validAvatar(value: string) {
    if (!value.trim()) return true;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' && !!url.hostname;
    } catch { return false; }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!current() || busy || saved || !profile || !changed) return;
    if (!validAvatar(avatar)) { writeError = 'use an HTTPS avatar URL.'; return; }
    busy = true;
    writeError = '';
    try {
      const status = await pds.saveProfile({ bio, avatar }, profile);
      if (!current()) return;
      saved = status;
      await load();
    } catch (failure) {
      if (current()) writeError = failure instanceof Error ? failure.message : 'could not save profile.';
    } finally { if (current()) busy = false; }
  }
</script>

<EditorPanel title="edit profile" close="/portal" {busy}>
  {#if saved}
    <p role="status" class="state">
      {saved === 'indexed' ? 'profile saved.' : saved === 'rejected' ? 'profile saved. the catalog could not show this change.' : 'profile saved. the catalog is catching up.'}
    </p>
  {/if}
  {#if loading}
    <Loading label="loading profile" inline />
  {:else if readError}
    <p role="alert" class="editor-error">{saved ? 'your changes are saved, but the latest profile could not be loaded.' : 'could not load your profile.'}</p>
    <p class="subtle">{readError}</p>
    <button class="text-button" onclick={load}>retry loading profile</button>
  {:else if profile}
    <form onsubmit={save} novalidate>
      <label>bio <textarea rows="5" bind:value={bio} disabled={busy || !!saved}></textarea></label>
      <label>avatar URL <input type="url" inputmode="url" bind:value={avatar} disabled={busy || !!saved} /></label>
      {#if writeError}<p role="alert" class="editor-error">{writeError}</p>{/if}
      <div class="editor-actions">
        {#if !saved}<button class="text-button editor-save" type="submit" disabled={busy || !changed}>{busy ? 'saving…' : 'save profile'}</button>{/if}
        {#if saved && latestRead && !busy}
          <button class="text-button" type="button" onclick={() => { saved = undefined; }}>edit again</button>
          <a class="text-button" href="/portal">back to your music</a>
        {/if}
      </div>
    </form>
  {/if}
</EditorPanel>
