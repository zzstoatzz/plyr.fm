/**
 * The scope to ask for when adding grants (teal.fm, reporting, the review queue) to a session.
 *
 * An account host checks every part of a request against the client's registered scope and
 * rejects the whole request if one part isn't registered. The scope a session holds is the
 * host's own wording of what it granted: it may put parameters in another order, or write
 * `authority=self` as the account's DID. It can also hold parts that an older build registered
 * and this one no longer does. Echoing it back verbatim is what broke "open the queue". So the
 * request is built only from this client's registered parts: those the session already holds,
 * matched by meaning rather than by spelling, plus the new ones.
 */
export function upgradeScope(registered: readonly string[], granted: string, parts: readonly string[], did?: string): string {
	const byMeaning = new Map(registered.map(part => [meaning(part), part]));
	const held = new Set<string>();
	for (const part of granted.split(' ').filter(Boolean)) {
		const match = byMeaning.get(meaning(part, did));
		if (match) held.add(match);
	}
	for (const part of parts) {
		if (!registered.includes(part)) throw new Error(`${part} is not in this client's registered scope`);
		held.add(part);
	}
	return registered.filter(part => held.has(part)).join(' ');
}

/** a scope part with its parameters sorted, and the account's own DID read as `self` */
function meaning(part: string, did?: string): string {
	const at = part.indexOf('?');
	if (at < 0) return part;
	const params = [...new URLSearchParams(part.slice(at + 1))]
		.map(([key, value]) => [key, key === 'authority' && did && value === did ? 'self' : value])
		.map(([key, value]) => `${key}=${value}`)
		.sort();
	return `${part.slice(0, at)}?${params.join('&')}`;
}
