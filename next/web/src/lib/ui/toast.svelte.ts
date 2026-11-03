// one toast at a time, bottom of the screen above the player.
class Toasts {
	message = $state<string | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(message: string, ms = 2800) {
		this.message = message;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => (this.message = null), ms);
	}
}

export const toast = new Toasts();

/** a short, human note for the result of a PDS write + appview await. */
export function writeNote(status: string, done: string): string {
	if (status === 'indexed') return done;
	if (status === 'pending') return `${done} · still indexing`;
	if (status === 'rejected') return 'saved to your PDS, but the appview rejected it';
	return done;
}
