/** The appview's stock error messages (next/backend/src/api/response.zig) are written for developers. */
const canned = new Set([
	'The request is invalid.', 'Authentication is required for this resource.', 'The request origin is not allowed.',
	'The session does not grant this operation.', 'The resource state is not ready for this operation.',
	'The requested resource was not found.', 'The resource does not support this method.',
	'Too many requests were made for this resource.', 'An upstream service could not complete the request.',
	'The request could not be completed.', 'The service is temporarily unavailable.'
]);

function plainError(status: number): string {
	if (status === 400) return "that didn't work. check it and try again.";
	if (status === 401) return 'sign in to do that.';
	if (status === 403) return "you can't do that with this account.";
	if (status === 404) return "this isn't on plyr.fm. it may have been deleted.";
	if (status === 409) return "this isn't ready yet. try again in a moment.";
	if (status === 429) return 'too many tries. wait a moment and try again.';
	return "plyr.fm couldn't finish that. try again in a moment.";
}

/** A server's own message when it says something specific, else plain copy for the status. */
export function readableError(status: number, message: unknown): string {
	return typeof message === 'string' && message && !canned.has(message) ? message : plainError(status);
}
