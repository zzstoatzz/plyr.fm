<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '$lib/ui/Icon.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import PdsAudioList from './PdsAudioList.svelte';
  import { pdsAudio } from './pds-audio.svelte';

  // Asked once per account on this device, the first time you're signed in with audio missing from your PDS.
  // After that the card on the you page carries it.
  let sheet: Sheet;
  let shown = false;
  const count = $derived(pdsAudio.fixable.length);

  $effect(() => {
    if (pdsAudio.showSheet && !shown) { shown = true; sheet.show(); }
  });

  function move() {
    pdsAudio.markAsked();
    void pdsAudio.moveAll();
    sheet.close();
    // the you page shows each track's progress
    if (page.url.pathname !== '/portal') void goto('/portal');
  }
</script>

<Sheet bind:this={sheet} title="some of your audio isn't on your PDS" onclose={() => { if (shown) pdsAudio.markAsked(); }}>
  <div class="body">
    <p>{count === 1 ? "one of your tracks isn't" : `${count} of your tracks aren't`} on your PDS right now. plyr.fm can put {count === 1 ? 'it' : 'them'} there, where the rest of your stuff lives. {count === 1 ? 'it keeps' : 'they keep'} playing the whole time.</p>
    <p class="why"><Icon name="info" size={15} /><span>sometimes a bug on our side or a hiccup at your PDS host leaves audio behind. sorry about that.</span></p>
    <div class="list"><PdsAudioList gaps={pdsAudio.gaps} /></div>
    <button class="go" type="button" onclick={move}><Icon name="upload" size={18} />move {count === 1 ? 'it' : 'them'} to your PDS</button>
    <button class="text-button later" type="button" onclick={() => { pdsAudio.markAsked(); sheet.close(); }}>not now</button>
  </div>
</Sheet>

<style>
  .body { display: grid; gap: 0.7rem; padding: 0 1.25rem 0.5rem; overflow-y: auto; }
  p { margin: 0; color: var(--muted); line-height: 1.45; }
  .why { display: flex; gap: 0.4rem; align-items: flex-start; color: var(--faint); font-size: var(--t-13-6); }
  .why :global(svg) { flex: none; margin-top: 0.15rem; }
  .list { max-height: 16rem; overflow-y: auto; }
  .go { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 3rem; border: 0; border-radius: 0.8rem; background: var(--accent); color: var(--on-accent); font-weight: 700; margin-top: 0.3rem; }
  .go:hover { filter: brightness(1.08); }
  .later { color: var(--muted); font-weight: 600; justify-self: center; }
</style>
