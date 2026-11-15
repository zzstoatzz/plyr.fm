<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="page-content">
	<h1>{page.error?.message ?? 'could not open this page'}</h1>
	<p class="state"><a href="/">back to home</a></p>
</div>
