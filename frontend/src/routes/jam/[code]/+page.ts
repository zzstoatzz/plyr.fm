import type { LoadEvent } from '@sveltejs/kit';

export interface PageData {
	code: string;
}

export function load({ params }: LoadEvent): PageData {
	return { code: params.code as string };
}
