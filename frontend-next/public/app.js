import { ApiError, getArtist, getPlayback, listTracks } from './api.js';

const catalog = requiredElement('catalog');
const status = requiredElement('catalog-status');
const heading = requiredElement('catalog-heading');
const loadMore = /** @type {HTMLButtonElement} */ (requiredElement('load-more'));
const clearArtist = /** @type {HTMLButtonElement} */ (requiredElement('clear-artist'));
const audio = /** @type {HTMLAudioElement} */ (requiredElement('audio'));
const nowTitle = requiredElement('now-title');
const nowArtist = requiredElement('now-artist');
const nowEvidence = requiredElement('now-evidence');

/** @type {import('./api.js').Track[]} */
let tracks = [];
/** @type {string | null} */
let cursor = null;
let hasMore = true;
/** @type {string | null} */
let artistDid = null;
let loading = false;
/** @type {string | null} */
let playingId = null;

async function loadInitial() {
	const requestedArtist = new URL(location.href).searchParams.get('artist');
	if (requestedArtist) {
		try {
			const artist = await getArtist(requestedArtist);
			artistDid = artist.did;
			heading.textContent = artist.display_name || artist.handle;
			clearArtist.hidden = false;
		} catch (error) {
			reportError(error, 'That artist is not available in the verified index.');
		}
	}
	await loadPage(true);
}

/** @param {boolean} replace */
async function loadPage(replace) {
	if (loading || (!replace && !hasMore)) return;
	loading = true;
	loadMore.disabled = true;
	status.textContent = replace ? 'loading verified catalog…' : 'loading more…';
	try {
		const page = await listTracks({ limit: 20, cursor: replace ? null : cursor, artistDid });
		tracks = replace ? page.data : [...tracks, ...page.data];
		cursor = page.next_cursor;
		hasMore = page.has_more;
		renderTracks();
		status.textContent = tracks.length === 0 ? 'No verified tracks are available in this view.' : `${tracks.length} verified track${tracks.length === 1 ? '' : 's'}`;
		loadMore.hidden = !hasMore;
	} catch (error) {
		reportError(error, 'The verified catalog could not be loaded.');
	} finally {
		loading = false;
		loadMore.disabled = false;
	}
}

function renderTracks() {
	catalog.replaceChildren(...tracks.map(renderTrack));
}

/** @param {import('./api.js').Track} track */
function renderTrack(track) {
	const item = document.createElement('article');
	item.className = 'track';
	item.dataset.trackId = track.id;

	const avatar = document.createElement('img');
	avatar.className = 'avatar';
	avatar.alt = '';
	avatar.loading = 'lazy';
	avatar.src = track.artist.profile.avatar_url || '/icon.svg';

	const body = document.createElement('div');
	body.className = 'track-body';
	const title = document.createElement('h2');
	title.textContent = track.metadata.title;
	const artist = document.createElement('button');
	artist.className = 'artist-link';
	artist.type = 'button';
	artist.textContent = track.artist.profile.display_name || track.artist.profile.handle;
	artist.addEventListener('click', () => selectArtist(track));
	const details = document.createElement('p');
	details.className = 'track-details';
	details.textContent = [
		track.metadata.album,
		formatDuration(track.metadata.duration_seconds),
		`${track.metrics.play_count.toLocaleString()} play${track.metrics.play_count === 1 ? '' : 's'}`
	].filter(Boolean).join(' · ');
	body.append(title, artist, details);

	const play = document.createElement('button');
	play.className = 'play';
	play.type = 'button';
	play.textContent = playingId === track.id && !audio.paused ? 'playing' : 'play';
	play.setAttribute('aria-label', `play ${track.metadata.title}`);
	play.addEventListener('click', () => playTrack(track, play));

	item.append(avatar, body, play);
	return item;
}

/** @param {import('./api.js').Track} track @param {HTMLButtonElement} button */
async function playTrack(track, button) {
	button.disabled = true;
	button.textContent = 'resolving…';
	try {
		const capability = await getPlayback(track.id);
		const delivery = capability.availability.delivery;
		if (capability.availability.status !== 'available' || !delivery) {
			throw new Error('Playback is not available for this catalog record.');
		}
		playingId = track.id;
		audio.src = delivery.url;
		nowTitle.textContent = track.metadata.title;
		nowArtist.textContent = track.artist.profile.display_name || track.artist.profile.handle;
		nowEvidence.textContent = `${delivery.integrity.replaceAll('_', ' ')} · ${delivery.source.replaceAll('_', ' ')}`;
		await audio.play();
		renderTracks();
	} catch (error) {
		reportError(error, 'Playback could not be resolved.');
		button.textContent = 'unavailable';
	} finally {
		button.disabled = false;
	}
}

/** @param {import('./api.js').Track} track */
function selectArtist(track) {
	const url = new URL(location.href);
	url.search = '';
	url.searchParams.set('artist', track.artist.did);
	location.href = url.toString();
}

function clearArtistFilter() {
	const url = new URL(location.href);
	url.search = '';
	location.href = url.toString();
}

/** @param {unknown} error @param {string} fallback */
function reportError(error, fallback) {
	console.error(error);
	status.textContent = error instanceof ApiError ? `${fallback} API status: ${error.status}.` : error instanceof Error ? error.message : fallback;
	status.classList.add('error');
}

/** @param {number | null} seconds */
function formatDuration(seconds) {
	if (seconds === null || seconds < 0) return null;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** @param {string} id */
function requiredElement(id) {
	const element = document.getElementById(id);
	if (!element) throw new Error(`missing #${id}`);
	return element;
}

loadMore.addEventListener('click', () => loadPage(false));
clearArtist.addEventListener('click', clearArtistFilter);
audio.addEventListener('pause', renderTracks);
audio.addEventListener('play', renderTracks);
void loadInitial();
