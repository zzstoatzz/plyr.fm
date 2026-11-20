<script lang="ts">
  import TagInput from './TagInput.svelte';
  let { album = $bindable(''), tags = $bindable(''), description = $bindable(''), autoTag = $bindable(false), tagProblem }: {
    album: string; tags: string; description: string; autoTag: boolean; tagProblem: string;
  } = $props();
</script>

<div class="details">
  <div class="card">
    <label class="field"><span>album</span><input bind:value={album} maxlength="256" placeholder="optional" /></label>
    <TagInput bind:value={tags} />
    {#if tagProblem}<p class="problem" role="alert">{tagProblem}</p>{/if}
    <label class="switch">
      <span><b>auto-tag with recommended genres</b><small>we listen once it's up and add a few genre tags. you can remove them later.</small></span>
      <input type="checkbox" role="switch" bind:checked={autoTag} />
    </label>
  </div>
  <div class="card">
    <label class="field"><span>description</span><textarea bind:value={description} maxlength="5000" rows="5" placeholder="liner notes, credits, lyrics…"></textarea></label>
    {#if description.length > 4500}<p class="subtle count">{description.length} / 5000</p>{/if}
  </div>
</div>

<style>
  .problem { color: light-dark(#a3271f, #ff8f87); font-size: 0.9rem; }
  .subtle { color: var(--muted); }
  .details { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .card { display: grid; gap: 1rem; align-content: start; padding: 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; }
  .field { display: grid; gap: 0.4rem; }
  .field > span { font-size: 0.8rem; font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
  .field :is(input, textarea) { width: 100%; min-width: 0; padding: 0.65rem 0.8rem; border: 1px solid var(--line); border-radius: 0.65rem; background: var(--bg); color: inherit; line-height: 1.4; }
  .field textarea { resize: vertical; }
  .field :is(input, textarea):focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .count { font-size: 0.8rem; text-align: right; }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 1rem; cursor: pointer; }
  .switch span { display: grid; gap: 0.15rem; }
  .switch small { color: var(--muted); font-size: 0.85rem; line-height: 1.35; }
  .switch input { appearance: none; flex: none; position: relative; width: 2.6rem; height: 1.5rem; margin: 0; border-radius: 999px; background: var(--hover); cursor: pointer; transition: background 0.15s; }
  .switch input::after { content: ''; position: absolute; left: 0.2rem; top: 0.2rem; width: 1.1rem; height: 1.1rem; border-radius: 50%; background: var(--faint); transition: transform 0.15s; }
  .switch input:checked { background: var(--accent); }
  .switch input:checked::after { transform: translateX(1.1rem); background: var(--on-accent); }
  @media (max-width: 720px) { .details { grid-template-columns: 1fr; } }
</style>
