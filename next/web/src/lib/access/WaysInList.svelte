<script lang="ts">
  import type { WayIn } from '@plyr/next-core/access/ways-in';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';

  // the panel a listener without access sees: also the upload page's preview of it
  let { artist, ways, note, empty, signIn, preview = false }: { artist: string; ways: WayIn[]; note?: string; empty?: boolean; signIn?: string; preview?: boolean } = $props();
  const icons: Record<string, IconName> = { buy: 'tag', support: 'heart', 'sign-in': 'user', members: 'users', supporter: 'heart', purchase: 'tag' };
</script>

<section class="ways" class:preview aria-label={preview ? 'what a listener without access sees' : 'how to listen'}>
  <p class="lead"><Icon name="lock" size={16} /> {artist} shares this one with some people</p>
  {#if ways.length}
    <ul>
      {#each ways as way (way.key)}
        <li>
          <Icon name={icons[way.kind]} size={18} />
          <span class="copy"><span>{way.title}</span><small>{way.detail}</small></span>
          {#if preview}{#if way.action}<span class="go" aria-hidden="true">{way.action}</span>{/if}
          {:else if way.url}<a class="go" href={way.url} target="_blank" rel="noopener noreferrer" aria-label={`${way.action} ${way.detail} (opens in a new tab)`}>{way.action} <Icon name="external" size={14} /></a>
          {:else if way.action === 'sign in' && signIn}<a class="go" href={signIn}>sign in</a>{/if}
        </li>
      {/each}
    </ul>
  {:else if empty}
    <p class="muted">only {artist} can listen right now.</p>
  {/if}
  {#if note}<p class="note">{note}</p>{/if}
</section>

<style>
  .ways { width: min(26rem, 100%); text-align: start; display: grid; gap: 0.6rem; margin-top: 0.5rem; }
  .lead { display: flex; align-items: center; justify-content: center; gap: 0.4rem; color: var(--muted); font-size: 0.9rem; }
  ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); overflow: hidden; }
  li { display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 0.9rem; border-bottom: 1px solid var(--line); color: var(--muted); }
  li:last-child { border-bottom: 0; }
  .copy { flex: 1; min-width: 0; display: grid; color: var(--text); }
  small { color: var(--faint); font-size: 0.8rem; }
  .go { display: inline-flex; align-items: center; gap: 0.3rem; min-height: 2.75rem; padding-inline: 0.4rem; color: var(--accent); font-weight: 650; font-size: 0.9rem; white-space: nowrap; }
  .note, .muted { color: var(--faint); font-size: 0.82rem; margin: 0 0.15rem; }
  .preview { width: 100%; margin-top: 0; }
  .preview .lead { justify-content: flex-start; }
</style>
