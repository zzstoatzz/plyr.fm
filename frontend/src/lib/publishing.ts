export const LISTENING_POLICIES = ['public', 'signed_in', 'supporters', 'owner', 'space'] as const;
export const DOWNLOAD_POLICIES = ['open', 'ask', 'supporters', 'off'] as const;
export const PUBLICATION_VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export interface PublishingDefaults {
	access: {
		listening: (typeof LISTENING_POLICIES)[number];
		downloads: (typeof DOWNLOAD_POLICIES)[number];
		visibility: (typeof PUBLICATION_VISIBILITIES)[number];
	};
	attach_rights: boolean;
}

export function defaultPublishing(): PublishingDefaults {
	return {
		access: { listening: 'public', downloads: 'open', visibility: 'public' },
		attach_rights: false
	};
}

export function parsePublishing(raw: string): PublishingDefaults {
	const parsed: Partial<PublishingDefaults> | null = JSON.parse(raw);
	const access = parsed?.access;
	const listening = LISTENING_POLICIES.find((option) => option === access?.listening);
	const downloads = DOWNLOAD_POLICIES.find((option) => option === access?.downloads);
	const visibility = PUBLICATION_VISIBILITIES.find((option) => option === access?.visibility);
	if (
		!listening ||
		!downloads ||
		!visibility ||
		(parsed?.attach_rights !== true && parsed?.attach_rights !== false)
	) {
		throw new Error('invalid publishing settings');
	}
	return { access: { listening, downloads, visibility }, attach_rights: parsed.attach_rights };
}

export function publishingSummary(settings: PublishingDefaults): string {
	const listening = {
		public: 'anyone can listen',
		signed_in: 'sign in to listen',
		supporters: 'supporters can listen',
		owner: 'only you can listen',
		space: 'Space members can listen'
	}[settings.access.listening];
	const downloads = {
		open: 'downloads allowed',
		ask: 'downloads allowed, with a support prompt',
		supporters: 'supporters can download',
		off: 'downloads off'
	}[settings.access.downloads];
	return `${listening} · ${downloads}`;
}
