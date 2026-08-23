// regression test for sandboxed embeds (leaflet et al): in an iframe without
// allow-same-origin, *accessing* window.localStorage throws a SecurityError.
// the safe wrappers must degrade to no-ops instead of throwing, or the embed
// bundle dies at import time and hydration never happens.
import { afterEach, describe, expect, it } from 'vitest';

import { safeLocalStorage, safeSessionStorage } from './safe-storage';

const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

function makeStorageThrow(): void {
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		get() {
			throw new DOMException('access denied', 'SecurityError');
		}
	});
}

afterEach(() => {
	if (original) {
		Object.defineProperty(window, 'localStorage', original);
	}
});

describe('safeLocalStorage with working storage', () => {
	it('round-trips values', () => {
		safeLocalStorage.setItem('safe-storage-test', 'hi');
		expect(safeLocalStorage.getItem('safe-storage-test')).toBe('hi');
		safeLocalStorage.removeItem('safe-storage-test');
		expect(safeLocalStorage.getItem('safe-storage-test')).toBeNull();
	});

	it('exposes length and key', () => {
		safeLocalStorage.setItem('safe-storage-test', 'hi');
		expect(safeLocalStorage.length).toBeGreaterThan(0);
		expect(safeLocalStorage.key(0)).toBe('safe-storage-test');
		safeLocalStorage.removeItem('safe-storage-test');
	});
});

describe('safeLocalStorage when storage access throws', () => {
	it('degrades to a no-op instead of throwing', () => {
		makeStorageThrow();
		expect(() => safeLocalStorage.setItem('k', 'v')).not.toThrow();
		expect(safeLocalStorage.getItem('k')).toBeNull();
		expect(() => safeLocalStorage.removeItem('k')).not.toThrow();
		expect(safeLocalStorage.key(0)).toBeNull();
		expect(safeLocalStorage.length).toBe(0);
	});
});

describe('safeSessionStorage', () => {
	it('round-trips values', () => {
		safeSessionStorage.setItem('safe-storage-test', 'hi');
		expect(safeSessionStorage.getItem('safe-storage-test')).toBe('hi');
		safeSessionStorage.removeItem('safe-storage-test');
	});
});
