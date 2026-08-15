import page from '../../../static/scrub-test.html?raw';
import type { RequestHandler } from './$types';

// served as a raw route (not a +page) so the root layout's Player — and its
// media-session registrations — never mount and contaminate the bisect
export const GET: RequestHandler = () =>
	new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
