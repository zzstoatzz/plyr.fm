import type { SensitiveImagesData } from '$lib/moderation.svelte';
import type { LoadEvent } from '@sveltejs/kit';

export interface LayoutData {
	sensitiveImages: SensitiveImagesData;
}

// auth and preferences are handled client-side via singletons
// this load function just passes through server data (sensitive images)
export async function load({ data }: LoadEvent): Promise<LayoutData> {
	return {
		sensitiveImages: data?.sensitiveImages ?? { image_ids: [], urls: [] }
	};
}
