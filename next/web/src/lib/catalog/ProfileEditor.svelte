<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { AwaitStatus } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import { avatarImage } from '$lib/media/avatar-image';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let { account }: { account: ReturnType<typeof auth.getAuth> } = $props();
  const pds = untrack(() => createPds(account));
  const profilePath = untrack(() => resolve('/(app)/u/[actor]', { actor: account.handle || account.did || '' }));
  type Profile = Awaited<ReturnType<typeof pds.myProfile>>;

  let profile = $state.raw<Profile>();
  let bio = $state('');
  let file = $state<File | null>();
  let preview = $state<string>();
  let loading = $state(true);
  let readError = $state('');
  let writeError = $state('');
  let imageError = $state('');
  let pending = $state(false);
  let busy = $state(false);
  let saved = $state<AwaitStatus>();
  let latestRead = $state(false);
  let leaving = $state<string>();
  let input = $state<HTMLInputElement>();
  let live = false;
  let generation = 0;

  const current = () => live && auth.getAuth().rpc === account.rpc;
  const stored = $derived(typeof profile?.value?.avatar === 'string' ? profile.value.avatar : undefined);
  const shown = $derived(file === null ? undefined : preview ?? stored);
  const changed = $derived(file !== undefined || bio.trim() !== (profile?.value?.bio ?? ''));

  $effect(() => {
    const url = file ? URL.createObjectURL(file) : undefined;
    preview = url;
    if (url) return () => URL.revokeObjectURL(url);
  });

  onMount(() => {
    live = true;
    void load();
    return () => { live = false; generation += 1; };
  });

  beforeNavigate(navigation => {
    if (!changed || saved || busy || leaving || navigation.type === 'leave') return;
    navigation.cancel();
    leaving = navigation.to?.url.href;
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
      file = undefined;
      latestRead = true;
    } catch (failure) {
      if (current()) readError = failure instanceof Error ? failure.message : 'could not load your profile.';
    } finally { if (current()) loading = false; }
  }

  async function choose(event: Event & { currentTarget: HTMLInputElement }) {
    const target = event.currentTarget;
    const picked = target.files?.[0];
    target.value = '';
    if (!picked) return;
    const attempt = ++generation;
    pending = true;
    imageError = '';
    try {
      const image = await avatarImage(picked);
      if (attempt === generation) file = image;
    } catch (failure) {
      if (attempt === generation) imageError = failure instanceof Error ? failure.message : 'could not open this image. choose a different photo.';
    } finally { if (attempt === generation) pending = false; }
  }

  function removeAvatar() {
    generation += 1;
    pending = false;
    imageError = '';
    file = stored ? null : undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!current() || busy || pending || saved || !profile || !changed) return;
    busy = true;
    writeError = '';
    try {
      const status = await pds.saveProfile({ bio, ...(file !== undefined ? { avatarFile: file } : {}) }, profile);
      if (!current()) return;
      saved = status;
      await load();
    } catch (failure) {
      if (current()) writeError = failure instanceof Error ? failure.message : 'could not save profile.';
    } finally { if (current()) busy = false; }
  }

  function discard() {
    const to = leaving;
    leaving = undefined;
    file = undefined;
    bio = typeof profile?.value?.bio === 'string' ? profile.value.bio : '';
    if (to) void goto(to);
  }
</script>

<div class="editor">
  <header>
    <h1>edit profile</h1>
    {#if !busy}<a class="icon-button" href={profilePath} aria-label="Close"><Icon name="x" /></a>{/if}
  </header>
  {#if saved}
    <p role="status" class="state">
      {saved === 'indexed' ? 'profile saved.' : saved === 'rejected' ? 'profile saved. the catalog could not show this change.' : 'profile saved. the catalog is catching up.'}
    </p>
  {/if}
  {#if loading && !profile}
    <Loading label="loading profile" inline />
  {:else if readError}
    <p role="alert" class="error">{saved ? 'your changes are saved, but the latest profile could not be loaded.' : 'could not load your profile.'}</p>
    <p class="subtle">{readError}</p>
    <button class="text-button" onclick={load}>retry loading profile</button>
  {:else if profile}
    <form onsubmit={save} novalidate>
      <div class="details">
        <div class="avatar-field">
          <button type="button" class="avatar" class:empty={!shown} disabled={busy || !!saved || pending}
            aria-label={shown ? 'change avatar' : 'add avatar'} onclick={() => input?.click()}>
            <Artwork src={shown} size={176} eager fallbackIcon="user" />
            <span class="overlay">{pending ? 'preparing…' : shown ? 'change avatar' : 'add avatar'}</span>
          </button>
          <input type="file" accept="image/*,.heic,.heif" aria-label="choose avatar image" bind:this={input} onchange={choose} hidden />
          {#if shown && !saved}<button type="button" class="text-button" disabled={busy || pending} onclick={removeAvatar}>remove avatar</button>{/if}
          {#if imageError}<p role="alert" class="error">{imageError}</p>{/if}
        </div>
        <label class="bio">
          bio
          <textarea rows="6" maxlength="2560" bind:value={bio} disabled={busy || !!saved} placeholder="what you make, where you play"></textarea>
        </label>
      </div>
      <p class="subtle hint">your avatar is stored on your PDS as a png or jpeg under 1 MB, cropped square.</p>
      {#if leaving}
        <div class="discard" role="alert">
          <p>discard your unsaved profile changes?</p>
          <button type="button" class="text-button" onclick={discard}>discard changes</button>
          <button type="button" class="text-button" onclick={() => { leaving = undefined; }}>keep editing</button>
        </div>
      {/if}
      {#if writeError}<p role="alert" class="error">{writeError}</p>{/if}
      <footer>
        {#if saved && latestRead && !busy}
          <button class="text-button" type="button" onclick={() => { saved = undefined; }}>edit again</button>
          <a class="text-button" href={profilePath}>view your profile</a>
        {:else if !saved}
          <a class="text-button" href={profilePath} aria-disabled={busy}>cancel</a>
          <button class="text-button save" type="submit" disabled={busy || pending || !changed}>{busy ? 'saving…' : 'save profile'}</button>
        {/if}
      </footer>
    </form>
  {/if}
</div>

<style>
  .editor { max-width: 44rem; margin: 0 auto; padding: clamp(1rem, 3vw, 1.5rem); border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  h1 { font-size: clamp(1.4rem, 4.5vw, 1.95rem); }
  form { display: grid; gap: 1rem; }
  .details { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: clamp(1rem, 4vw, 1.75rem); align-items: start; }
  .avatar-field { display: grid; justify-items: center; gap: 0.5rem; }
  .avatar { position: relative; width: 11rem; aspect-ratio: 1; padding: 0; border: 0; border-radius: 50%; overflow: hidden; background: var(--raised); }
  .overlay { position: absolute; inset: 0; display: grid; place-items: center; color: white; background: rgb(0 0 0 / 0.45); opacity: 0; transition: opacity 0.15s; }
  .avatar:hover .overlay, .avatar:focus-visible .overlay, .avatar.empty .overlay, .avatar:disabled .overlay { opacity: 1; }
  .avatar:disabled { opacity: 1; }
  label.bio { display: grid; gap: 0.4rem; min-width: 0; }
  textarea { width: 100%; min-width: 0; padding: 0.7rem; border-radius: 0.6rem; background: var(--bg); border: 1px solid var(--line); resize: vertical; }
  .hint { font-size: 0.875rem; }
  .discard { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0.75rem; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--raised); }
  .discard p { flex: 1 1 100%; }
  footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
  .save { background: var(--accent); color: var(--on-accent); padding-inline: 1.1rem; }
  .save:hover { background: var(--accent); filter: brightness(1.12); }
  .error { margin: 0.25rem 0; }
  @media (max-width: 560px) {
    .details { grid-template-columns: minmax(0, 1fr); }
    .avatar { width: 9.5rem; }
  }
</style>
