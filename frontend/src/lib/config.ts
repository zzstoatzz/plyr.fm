import { browser } from '$app/environment';

export const API_URL = browser
	? (window.location.hostname === 'localhost'
		? 'http://localhost:8001'
		: 'https://relay-api.fly.dev')
	: 'https://relay-api.fly.dev';
