<script lang="ts">
  import { page } from '$app/state';
</script>

<p class="state">{page.status === 404 ? 'embed not found.' : 'could not load this embed.'}</p>

<style>p { padding: 0.65rem; }</style>
