<script lang="ts">
  import { apology, movingCopy, offerCopy, resultCopy } from '@plyr/next-core/publishing/pds-audio-store';
  import Icon from '$lib/ui/Icon.svelte';
  import PdsAudioList from './PdsAudioList.svelte';
  import { pdsAudio } from './pds-audio.svelte';

  // On the you page while something of yours isn't on your PDS, then the move's progress and outcome.
  let whyOpen = $state(false);
  const audio = $derived(pdsAudio.state);
  const offer = $derived(offerCopy(audio.fixable.length));
  const progress = $derived(movingCopy(audio));
  const result = $derived(resultCopy(audio));
</script>

{#if audio.showCard}
  <section class="gap-card" aria-label="audio not on your PDS" aria-live="polite">
    {#if audio.moving}
      <div class="top">
        <span class="ico" aria-hidden="true"><span class="spin"></span></span>
        <div class="words">
          <h2>{progress.title}</h2>
          <p>{progress.detail}</p>
        </div>
      </div>
      <PdsAudioList gaps={audio.gaps} />
    {:else if audio.finished}
      <div class="top">
        <span class="ico" class:ok={result.allMoved} aria-hidden="true"><Icon name={result.allMoved ? 'check' : 'cloud_up'} size={21} /></span>
        <div class="words">
          <h2>{result.title}</h2>
          {#if result.detail}<p>{result.detail}</p>{/if}
        </div>
        {#if result.allMoved}<button class="text-button" type="button" aria-label="close" onclick={pdsAudio.close}><Icon name="x" size={16} /></button>{/if}
      </div>
      {#if !result.allMoved}
        <PdsAudioList gaps={audio.gaps} />
        <div class="end">
          {#if result.retry}<button class="text-button" type="button" onclick={pdsAudio.moveAll}>try again</button>{/if}
          <button class="text-button" type="button" onclick={pdsAudio.close}>done</button>
        </div>
      {/if}
    {:else}
      <div class="top">
        <span class="ico" aria-hidden="true"><Icon name="cloud_up" size={21} /></span>
        <div class="words">
          <h2>{offer.title}</h2>
          <p>{offer.detail}</p>
        </div>
        <div class="buttons">
          <button class="text-button later" type="button" onclick={pdsAudio.dismiss}>not now</button>
          <button class="go" type="button" onclick={pdsAudio.moveAll}><Icon name="upload" size={17} /><span>move {audio.fixable.length === 1 ? 'it' : 'them'}<span class="long"> to your PDS</span></span></button>
        </div>
      </div>
      <button class="why" type="button" aria-expanded={whyOpen} onclick={() => { whyOpen = !whyOpen; }}>
        <Icon name="info" size={15} /><span>{#if whyOpen}{apology}{:else}<u>why did this happen?</u>{/if}</span>
      </button>
      <div class="list"><PdsAudioList gaps={audio.gaps} /></div>
    {/if}
  </section>
{/if}

<style>
  .gap-card { border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--line)); background: color-mix(in srgb, var(--accent) 7%, var(--surface)); border-radius: 0.9rem; padding: 0.85rem 1rem; margin: 0 0 1.5rem; }
  .top { display: flex; align-items: center; gap: 0.85rem; }
  .ico { width: 2.5rem; height: 2.5rem; border-radius: 0.75rem; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); display: grid; place-items: center; flex: none; }
  .ico.ok { color: #3fae6a; background: rgb(63 174 106 / 0.15); }
  .words { flex: 1; min-width: 0; }
  h2 { font-size: var(--t-16-8); font-weight: 700; margin: 0; }
  .words p { margin: 0.1rem 0 0; color: var(--muted); font-size: var(--t-13-6); line-height: 1.4; }
  .buttons { display: flex; align-items: center; gap: 0.4rem; flex: none; }
  .later { color: var(--muted); font-weight: 600; }
  .go { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2.6rem; padding: 0 1rem; border: 0; border-radius: 0.7rem; background: var(--accent); color: var(--on-accent); font-weight: 700; white-space: nowrap; }
  .go:hover { filter: brightness(1.08); }
  .why { display: flex; align-items: flex-start; gap: 0.4rem; margin: 0.55rem 0 0; padding: 0; border: 0; background: none; color: var(--faint); font-size: var(--t-13-6); text-align: start; line-height: 1.4; }
  .why :global(svg) { flex: none; margin-top: 0.1rem; }
  .why u { text-decoration-style: dotted; text-underline-offset: 3px; color: var(--muted); }
  .gap-card :global(.gaps) { margin-top: 0.75rem; }
  .end { display: flex; justify-content: flex-end; gap: 0.25rem; margin-top: 0.4rem; }
  .spin { width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent); border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
  @media (max-width: 720px) {
    .top { flex-wrap: wrap; }
    .words { flex-basis: calc(100% - 3.5rem); }
    .buttons { flex-basis: 100%; flex-direction: row-reverse; }
    .go { flex: 1; justify-content: center; }
    .long { display: none; }
    .list { display: none; }
  }
</style>
