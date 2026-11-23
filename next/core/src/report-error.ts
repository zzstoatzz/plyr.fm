/** Surfaces a subscriber's error (the console, error tracking) without stopping the subscribers after it. */
export function reportError(error: unknown) {
	if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
	else queueMicrotask(() => { throw error; });
}
