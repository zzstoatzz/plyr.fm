/**
 * Why a closed track will not play for this listener, when the listener (not a network hiccup) has to do something
 * about it, or can do nothing at all. Players keep only the message, so `listenBlock` reads the reason back from it.
 */
export type ListenBlock = 'sign-in' | 'reconnect' | 'unsupported-host';

const messages: Record<ListenBlock, string> = {
	'sign-in': 'sign in to play this track',
	reconnect: 'sign in again to play this track',
	'unsupported-host': 'your account’s hosting provider doesn’t support private tracks yet, so this track can’t play for you.'
};

export class ListenBlocked extends Error {
	readonly block: ListenBlock;
	constructor(block: ListenBlock) {
		super(messages[block]);
		this.block = block;
		this.name = 'ListenBlocked';
	}
}

export function listenBlock(message: string | null | undefined): ListenBlock | undefined {
	return (Object.keys(messages) as ListenBlock[]).find(block => messages[block] === message);
}

/** The listener's sign-in link for a block they can clear by signing in. */
export function signInLabel(block: ListenBlock | undefined): string | undefined {
	return block === 'sign-in' ? 'sign in' : block === 'reconnect' ? 'sign in again' : undefined;
}

const unsupportedErrors = new Set(['MethodNotImplemented', 'UnknownMethod', 'MethodNotFound', 'XRPCNotSupported']);

/**
 * The listener's own account host answered a delegation request with `response`: a host that has no private-track
 * support says so (501, or an unknown-method error) and will keep saying so; an expired session needs a new sign-in.
 * Anything else may pass on its own.
 */
export async function delegationRefusal(response: Response): Promise<Error> {
	const failure: { error?: unknown } | undefined = await response.json().catch(() => undefined);
	const code = typeof failure?.error === 'string' ? failure.error : undefined;
	if (response.status === 501 || code && unsupportedErrors.has(code)) return new ListenBlocked('unsupported-host');
	if (response.status === 401 || code === 'InvalidToken' || code === 'ExpiredToken' || code === 'AuthMissing') return new ListenBlocked('reconnect');
	return new Error('plyr.fm couldn’t reach your account’s hosting provider. try again in a moment.');
}
