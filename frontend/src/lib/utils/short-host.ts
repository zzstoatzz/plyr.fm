const MAX_HOST_LENGTH = 24;

/** shorten a long hostname to its registrable tail (last two labels). */
export function shortHost(host: string): string {
	if (host.length <= MAX_HOST_LENGTH) return host;
	return host.split('.').slice(-2).join('.');
}
