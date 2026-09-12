import { API_URL } from '$lib/config';
import type { PublishingDefaults } from '$lib/publishing';

interface PublishingChange {
	settings: PublishingDefaults | null;
	replace_overrides?: boolean;
}

interface PublishingJob {
	status: 'pending' | 'processing' | 'completed' | 'failed';
	message: string | null;
	updated_track_ids: number[];
	failed_track_ids: number[];
}

export async function changePublishing(path: string, change: PublishingChange): Promise<void> {
	const response = await fetch(`${API_URL}${path}`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(change)
	});
	if (!response.ok) throw new Error('could not start access change — retry');
	const queued: { job_id: string } = await response.json();
	for (let attempt = 0; attempt < 450; attempt++) {
		const progress = await fetch(`${API_URL}/tracks/publishing-jobs/${queued.job_id}`, {
			credentials: 'include'
		});
		if (!progress.ok)
			throw new Error('could not check access change — refresh to check your tracks');
		const job: PublishingJob = await progress.json();
		if (job.status === 'completed') return;
		if (job.status === 'failed') {
			if (!job.updated_track_ids.length && !job.failed_track_ids.length)
				throw new Error(job.message ?? 'access change failed — refresh before retrying');
			throw new Error(
				`${job.updated_track_ids.length} tracks updated; ${job.failed_track_ids.length} could not be updated. refresh before retrying.`
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error('access change is still running — refresh to check your tracks');
}
