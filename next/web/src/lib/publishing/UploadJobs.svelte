<script lang="ts">
  import { trackIdFromUri } from '@plyr/next-core/api';
  import { jobLine } from '@plyr/next-core/publishing/upload-queue-model';
  import { uploadQueue } from '$lib/upload';
  import Icon from '$lib/ui/Icon.svelte';

  let { jobs, disabled, edit }: { jobs: ReturnType<typeof uploadQueue.snapshot>; disabled: boolean; edit: (id: string) => void } = $props();
</script>

{#if jobs.length}
  <section class="jobs" aria-label="Upload queue" aria-live="polite">
    <h2>your uploads</h2>
    <ul>
      {#each jobs as job (job.id)}
        <li class:failed={job.phase === 'failed'}>
          <span class="job-icon"><Icon name={job.phase === 'done' ? 'check' : job.phase === 'failed' ? 'info' : 'upload'} size={18} /></span>
          <span class="job-line">
            {jobLine(job)}
            {#if job.phase === 'uploading' && job.progress !== undefined}<span class="meter"><i style:width="{Math.min(100, job.progress * 100)}%"></i></span>{/if}
          </span>
          {#if job.phase === 'done' && job.uri}<a class="text-button" href={`/track/${trackIdFromUri(job.uri)}`}>view track</a>{/if}
          {#if job.phase === 'failed' && uploadQueue.editable(job.id)}<button class="text-button" onclick={() => edit(job.id)} {disabled}>edit and try again</button>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .jobs { display: grid; gap: 0.35rem; }
  .jobs h2 { font-size: 0.95rem; color: var(--muted); }
  .jobs ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.25rem; }
  .jobs li { display: flex; align-items: center; gap: 0.75rem; min-height: 3rem; padding: 0.35rem 0.5rem; border-radius: 0.7rem; background: var(--surface); border: 1px solid var(--line); }
  .jobs li.failed .job-icon { color: light-dark(#a3271f, #ff8f87); }
  .job-icon { width: 2.25rem; height: 2.25rem; flex: none; display: grid; place-items: center; border-radius: 0.5rem; background: var(--raised); color: var(--accent); }
  .job-line { flex: 1; min-width: 0; display: grid; gap: 0.3rem; overflow-wrap: anywhere; }
  .meter { height: 0.3rem; border-radius: 999px; background: var(--hover); overflow: hidden; }
  .meter i { display: block; height: 100%; background: var(--accent); transition: width 0.3s; }
</style>
