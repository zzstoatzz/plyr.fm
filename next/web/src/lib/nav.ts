/** The desktop sidebar's open or collapsed state. A per-device layout choice, so it lives in this browser
 *  rather than the account's synced prefs; app.html applies it before the first paint. */
const key = 'plyr-next:nav';

export function navCollapsed() {
	return document.documentElement.dataset.nav === 'collapsed';
}

export function setNavCollapsed(collapsed: boolean) {
	if (collapsed) document.documentElement.dataset.nav = 'collapsed';
	else delete document.documentElement.dataset.nav;
	try {
		if (collapsed) localStorage.setItem(key, 'collapsed');
		else localStorage.removeItem(key);
	} catch {}
}
