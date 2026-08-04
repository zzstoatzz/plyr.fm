// storage wrappers that survive sandboxed iframes.
//
// in an iframe sandboxed without allow-same-origin (e.g. embeds inside
// Leaflet documents), the document has an opaque origin and *accessing*
// window.localStorage/sessionStorage throws a SecurityError — `typeof`
// and `browser` guards don't catch it. every access goes through try/catch
// so embeds degrade to no persistence instead of failing to hydrate.

export interface SafeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	readonly length: number;
}

function wrap(getStorage: () => Storage): SafeStorage {
	return {
		getItem(key) {
			try {
				return getStorage().getItem(key);
			} catch {
				return null;
			}
		},
		setItem(key, value) {
			try {
				getStorage().setItem(key, value);
			} catch {
				// unavailable (sandboxed/opaque origin) or quota exceeded
			}
		},
		removeItem(key) {
			try {
				getStorage().removeItem(key);
			} catch {
				// unavailable
			}
		},
		key(index) {
			try {
				return getStorage().key(index);
			} catch {
				return null;
			}
		},
		get length() {
			try {
				return getStorage().length;
			} catch {
				return 0;
			}
		}
	};
}

export const safeLocalStorage: SafeStorage = wrap(() => window.localStorage);
export const safeSessionStorage: SafeStorage = wrap(() => window.sessionStorage);
