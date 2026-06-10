// test stand-in for the `$app/stores` virtual module
import { readable } from 'svelte/store';

export const page = readable({
	url: new URL('http://localhost/'),
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	form: undefined,
	state: {}
});
