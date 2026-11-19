<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // A bottom sheet on phones and a centered panel on wider screens.
  let { title, subtitle, children, onclose, busy = false }: { title: string; subtitle?: string; children: Snippet; onclose?: () => void; busy?: boolean } = $props();
  let dialog: HTMLDialogElement;
  let open = $state(false);
  export function show() { if (!dialog.open) dialog.showModal(); open = true; }
  export function close() { dialog.close(); }
  const titleId = $props.id();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="sheet" aria-labelledby={titleId} data-player-no-pull
  onclose={() => { open = false; onclose?.(); }}
  oncancel={event => { if (busy) event.preventDefault(); }}
  onclick={event => { if (event.target === dialog && !busy) dialog.close(); }}>
  <div class="body">
    <header>
      <div class="titles"><h2 id={titleId}>{title}</h2>{#if subtitle}<p class="truncate">{subtitle}</p>{/if}</div>
      <button class="icon-button" type="button" aria-label={`Close ${title}`} disabled={busy} onclick={() => dialog.close()}><Icon name="x" size={20} /></button>
    </header>
    {#if open}{@render children()}{/if}
  </div>
</dialog>

<style>
  .sheet { width: min(28rem, calc(100% - 2rem)); max-height: min(40rem, calc(100dvh - 2rem)); padding: 0; border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); color: var(--text); box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 0.25); }
  .sheet::backdrop { background: rgb(0 0 0 / 0.5); }
  .body { display: flex; flex-direction: column; max-height: inherit; padding: 0.4rem 0 0.75rem; text-align: start; }
  header { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem 0.5rem 1.25rem; }
  .titles { flex: 1; min-width: 0; }
  h2 { font-size: 1.05rem; font-weight: 650; }
  header p { color: var(--faint); font-size: 0.85rem; }
  @media (max-width: 720px) {
    .sheet { width: 100%; max-width: 100%; margin: auto 0 0; border-width: 1px 0 0; border-radius: 1.25rem 1.25rem 0 0; max-height: 85dvh; }
    .body { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }
    .body::before { content: ''; align-self: center; width: 2.4rem; height: 0.3rem; border-radius: 1rem; background: var(--line); margin-bottom: 0.2rem; }
  }
</style>
