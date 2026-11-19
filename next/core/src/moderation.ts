import type { Agent } from './auth-state.ts';

/** What a listener can say is wrong; the server keeps the same list. */
export const REPORT_REASONS = [
	{ value: 'copyright', label: "someone else's music", detail: 'uploaded without the rights to it' },
	{ value: 'sexual', label: "sexual content that isn't marked", detail: 'should be behind the sensitive audio setting' },
	{ value: 'spam', label: 'spam', detail: 'junk, ads or the same thing over and over' },
	{ value: 'harassment', label: 'harassment or hate', detail: '' },
	{ value: 'impersonation', label: 'pretending to be someone', detail: '' },
	{ value: 'other', label: 'something else', detail: '' }
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/** The server counts bytes, not characters. */
export const REPORT_DETAIL_LIMIT = 2000;
export const noteTooLong = (text: string) => new TextEncoder().encode(text.trim()).length > REPORT_DETAIL_LIMIT;

/** Labels an operator can put on a track or an account. */
export const TRACK_LABELS = ['copyright-violation', 'sexual', 'porn'] as const;
export const ACCOUNT_LABELS = ['ai'] as const;

export type Decision = 'acknowledged' | 'override_allow' | 'override_exclude' | 'override_clear' | 'label_applied' | 'label_negated';

export type QueueItem = {
	cursor: number;
	subject: string;
	openedAt: number;
	openCount: number;
	reasonTypes: string[];
	trackTitle: string | null;
	trackOwner: string | null;
	decision: string | null;
};

export type SubjectEvent = {
	id: number;
	subject: string;
	action: string;
	actor: string;
	reasonType: string | null;
	reason: string | null;
	labelValue: string | null;
	createdAt: number;
};

export type ModerationConfig = { apiOrigin: string; audience: string; methods: { createReport: string; getQueue: string; getSubject: string; emitEvent: string } };

/** The server answered, but not with what was asked for; `code` is its error name. */
export class ModerationError extends Error {
	readonly code: string;
	readonly status: number;
	constructor(message: string, code: string, status: number) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const messages: Record<string, string> = {
	RateLimitExceeded: "you've sent a lot of reports recently. try again in a while.",
	UnknownSubject: "we couldn't find this anymore. it may have been deleted.",
	Forbidden: 'only moderators can see this.',
	InvalidLabel: "that label doesn't fit here.",
	LabelerUnavailable: "labels aren't switched on yet.",
	UnsupportedSubject: 'allow and hide only work on tracks for now.',
	InvalidRequest: "that didn't go through. shorten the note and try again.",
	ServiceUnavailable: "moderation isn't reachable right now. try again in a minute."
};

export function createModerationClient(agent: Agent, config: ModerationConfig) {
	async function call(method: string, init: RequestInit & { query?: Record<string, string> } = {}, signal?: AbortSignal): Promise<unknown> {
		const auth = new URLSearchParams({ aud: config.audience, lxm: method });
		const issued = await agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${auth}`, { signal });
		const grant: unknown = issued.ok ? await issued.json() : null;
		if (!grant || typeof grant !== 'object' || !('token' in grant) || typeof grant.token !== 'string') {
			throw new ModerationError('sign in again to continue.', 'GrantRequired', issued.status);
		}
		const query = init.query ? `?${new URLSearchParams(init.query)}` : '';
		const response = await fetch(`${config.apiOrigin}/xrpc/${method}${query}`, {
			method: init.method ?? 'GET',
			body: init.body,
			signal,
			headers: { authorization: `Bearer ${grant.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) }
		});
		const body: unknown = await response.json().catch(() => null);
		if (response.ok) return body;
		const code = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Failed';
		throw new ModerationError(messages[code] ?? "that didn't go through. try again.", code, response.status);
	}

	return {
		/** Duplicates within a day look the same as a new report. */
		async report(subject: string, reason: ReportReason, detail: string, signal?: AbortSignal): Promise<void> {
			const trimmed = detail.trim();
			await call(config.methods.createReport, { method: 'POST', body: JSON.stringify({ subject, reasonType: reason, ...(trimmed ? { reason: trimmed } : {}) }) }, signal);
		},
		async queue(cursor?: string, signal?: AbortSignal): Promise<{ items: QueueItem[]; cursor?: string }> {
			const body = await call(config.methods.getQueue, { query: cursor ? { cursor } : {} }, signal) as { items?: QueueItem[]; cursor?: string };
			return { items: body.items ?? [], cursor: body.cursor };
		},
		async subject(subject: string, signal?: AbortSignal): Promise<SubjectEvent[]> {
			const body = await call(config.methods.getSubject, { query: { subject } }, signal) as { events?: SubjectEvent[] };
			return body.events ?? [];
		},
		async decide(subject: string, action: Decision, options: { reason?: string; value?: string } = {}, signal?: AbortSignal): Promise<void> {
			const reason = options.reason?.trim();
			await call(config.methods.emitEvent, { method: 'POST', body: JSON.stringify({ subject, action, ...(reason ? { reason } : {}), ...(options.value ? { value: options.value } : {}) }) }, signal);
		}
	};
}
export type ModerationClient = ReturnType<typeof createModerationClient>;
