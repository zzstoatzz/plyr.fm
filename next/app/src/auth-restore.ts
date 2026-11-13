// Native session restore can refresh tokens over the network with no deadline of
// its own. Startup must not wait on it: after `ms` the app continues signed out and
// the attempt keeps running, so a late success can still sign the account back in.

export type RestoreOutcome<T> =
	| { kind: 'restored'; value: T }
	| { kind: 'expired'; reason: unknown }
	| { kind: 'unreachable'; reason: unknown };

export type BoundedRestore<T> =
	| RestoreOutcome<T>
	| { kind: 'slow'; late: Promise<RestoreOutcome<T>> };

export function restoreWithin<T>(attempt: Promise<T>, ms: number, isExpired: (reason: unknown) => boolean): Promise<BoundedRestore<T>> {
	const outcome: Promise<RestoreOutcome<T>> = attempt.then(
		value => ({ kind: 'restored', value }),
		reason => ({ kind: isExpired(reason) ? 'expired' : 'unreachable', reason })
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<BoundedRestore<T>>(resolve => {
		timer = setTimeout(() => resolve({ kind: 'slow', late: outcome }), ms);
	});
	return Promise.race([outcome, deadline]).finally(() => clearTimeout(timer));
}
