<script lang="ts">
  import { onMount } from 'svelte';
  import { noteTooLong, REPORT_REASONS, type ReportReason } from '@plyr/next-core/moderation';
  import { addGrants, auth, grantFailure } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { toast } from '$lib/toast.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import { moderation } from './client';

  // `name` is how the thing reads to people: a track title or an artist's name.
  let { subject, name, owner, returnTo, onclose }: { subject: string; name: string; owner?: string; returnTo: string; onclose?: () => void } = $props();
  let sheet: Sheet;
  let reason = $state<ReportReason | null>(null);
  let detail = $state('');
  let busy = $state(false);
  let error = $state('');
  let active: AbortController | undefined;
  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { const next = auth.getAuth(); if (next.did !== account.did) sheet?.close(); account = next; }));
  const tooLong = $derived(noteTooLong(detail));
  let granting = $state(false);
  async function allowReports() {
    granting = true;
    error = '';
    try { await addGrants([authConfig.REPORT_SCOPE], returnTo); }
    catch (failure) { console.warn('report grant did not start', failure); error = grantFailure(failure) ?? ''; granting = false; }
  }
  export function show() { error = ''; sheet.show(); }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !reason || tooLong || !account.agent) return;
    busy = true;
    error = '';
    const controller = active = new AbortController();
    try {
      await moderation(account.agent).report(subject, reason, detail, controller.signal);
      reason = null;
      detail = '';
      busy = false;
      sheet.close();
      toast.add(`thanks. we'll take a look at "${name}".`, 'success', 5000);
    } catch (failure) {
      if (controller.signal.aborted) return;
      // keep what they picked and wrote, so trying again is one tap
      error = failure instanceof Error ? failure.message : "that didn't go through. try again.";
    } finally {
      if (active === controller) { active = undefined; busy = false; }
    }
  }
</script>

<Sheet bind:this={sheet} title={`report "${name}"`} {busy} onclose={() => { active?.abort(); onclose?.(); }}>
  {#if !account.reporting}
    <div class="grant">
      <p>to send reports, let plyr.fm send them for you. you'll come right back here.</p>
      <button class="hero-pill primary" type="button" disabled={granting} onclick={allowReports}>{granting ? 'opening…' : 'allow reports'}</button>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  {:else}
    <form onsubmit={send}>
      <p class="lead">tell us what's wrong. a person reads every report.</p>
      <fieldset disabled={busy}>
        <legend class="sr-only">what's wrong</legend>
        {#each REPORT_REASONS as option (option.value)}
          <label class="reason" class:picked={reason === option.value}>
            <input type="radio" name="reason" value={option.value} bind:group={reason} />
            <span><strong>{option.label}</strong>{#if option.detail}<small>{option.detail}</small>{/if}</span>
          </label>
        {/each}
      </fieldset>
      {#if reason}
        <label class="detail">
          <span class="sr-only">anything that helps (optional)</span>
          <textarea bind:value={detail} rows="3" placeholder="anything that helps (optional)" disabled={busy} aria-invalid={tooLong}></textarea>
        </label>
        {#if tooLong}<p class="error" role="alert">that note is too long. shorten it a little.</p>{/if}
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <footer>
        {#if owner}<small>{owner} won't see who reported</small>{/if}
        <button class="hero-pill primary" type="submit" disabled={!reason || busy || tooLong}>{busy ? 'sending…' : 'send report'}</button>
      </footer>
    </form>
  {/if}
</Sheet>

<style>
  form, .grant { display: flex; flex-direction: column; gap: 0.6rem; padding: 0 1.25rem; overflow-y: auto; }
  .lead, .grant p { color: var(--muted); font-size: 0.9rem; }
  fieldset { display: flex; flex-direction: column; gap: 0.35rem; border: 0; padding: 0; margin: 0; }
  .reason { display: flex; align-items: center; gap: 0.75rem; min-height: 2.9rem; padding: 0.5rem 0.75rem; border: 1px solid var(--line); border-radius: 0.7rem; cursor: pointer; }
  .reason.picked { border-color: var(--accent); background: var(--raised); }
  .reason input { accent-color: var(--accent); width: 1.1rem; height: 1.1rem; flex: none; }
  .reason span { display: flex; flex-direction: column; min-width: 0; }
  .reason strong { font-weight: 550; font-size: 0.92rem; }
  .reason small, footer small { color: var(--faint); font-size: 0.8rem; }
  textarea { width: 100%; font: inherit; font-size: 16px; padding: 0.6rem 0.75rem; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--bg); color: var(--text); resize: vertical; }
  .error { color: light-dark(#b42318, #ff8a80); font-size: 0.85rem; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding-top: 0.25rem; }
  footer .hero-pill { margin-inline-start: auto; }
  .grant .hero-pill { align-self: start; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
