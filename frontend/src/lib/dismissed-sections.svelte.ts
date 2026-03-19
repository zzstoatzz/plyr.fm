import { browser } from '$app/environment';

const STORAGE_KEY = 'plyr:dismissed-sections';

function load(): Set<string> {
	if (!browser) return new Set();
	try {
		return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
	} catch {
		return new Set();
	}
}

function save(sections: Set<string>) {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify([...sections]));
}

let dismissed = $state(load());

export const dismissedSections = {
	get set() {
		return dismissed;
	},

	has(section: string): boolean {
		return dismissed.has(section);
	},

	dismiss(section: string) {
		dismissed = new Set([...dismissed, section]);
		save(dismissed);
	},

	restore(section: string) {
		const next = new Set(dismissed);
		next.delete(section);
		dismissed = next;
		save(dismissed);
	},

	restoreAll() {
		dismissed = new Set();
		save(dismissed);
	},

	get hasDismissed(): boolean {
		return dismissed.size > 0;
	}
};
