import { ApiError, getArtist, getPlayback, getPlaylist, listPlaylists, listTracks } from './api.js';

const catalog = requiredElement('catalog');
const status = requiredElement('catalog-status');
const heading = requiredElement('catalog-heading');
const loadMore = /** @type {HTMLButtonElement} */ (requiredElement('load-more'));
const clearArtist = /** @type {HTMLButtonElement} */ (requiredElement('clear-artist'));
const audio = /** @type {HTMLAudioElement} */ (requiredElement('audio'));
const nowTitle = requiredElement('now-title');
const nowArtist = requiredElement('now-artist');
const nowEvidence = requiredElement('now-evidence');
const tracksNav = requiredElement('tracks-nav');
const playlistsNav = requiredElement('playlists-nav');

/** @type {import('./api.js').Track[]} */
let tracks = [];
/** @type {import('./api.js').PlaylistSummary[]} */
let playlists = [];
/** @type {import('./api.js').Playlist | null} */
let playlistDetail = null;
/** @type {string | null} */
let cursor = null;
let hasMore = true;
/** @type {'tracks' | 'playlists'} */
let view = 'tracks';
/** @type {string | null} */
let artistDid = null;
let loading = false;
/** @type {string | null} */
let playingId = null;

async function loadInitial() {
	const parameters = new URL(location.href).searchParams;
	const requestedPlaylist = parameters.get('playlist');
	view = requestedPlaylist || parameters.get('view') === 'playlists' ? 'playlists' : 'tracks';
	setActiveNavigation();
	if (requestedPlaylist) {
		await loadPlaylistDetail(requestedPlaylist);
		return;
	}

	const requestedArtist = view === 'tracks' ? parameters.get('artist') : null;
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

/** @param {string} playlistId */
async function loadPlaylistDetail(playlistId) {
	status.textContent = 'loading source-authenticated playlist…';
	loadMore.hidden = true;
	try {
		playlistDetail = await getPlaylist(playlistId);
		heading.textContent = playlistDetail.metadata.name || 'untitled playlist';
		clearArtist.textContent = 'all playlists';
		clearArtist.hidden = false;
		renderCurrent();
		const count = playlistDetail.metrics.member_count;
		status.textContent = `${count} source position${count === 1 ? '' : 's'} · ${playlistDetail.metrics.available_count} currently available`;
	} catch (error) {
		reportError(error, 'That playlist is not available in the verified index.');
	}
}

/** @param {boolean} replace */
async function loadPage(replace) {
	if (loading || (!replace && !hasMore)) return;
	loading = true;
	loadMore.disabled = true;
	status.textContent = replace ? 'loading verified catalog…' : 'loading more…';
	try {
		status.classList.remove('error');
		if (view === 'playlists') {
			const page = await listPlaylists({ limit: 20, cursor: replace ? null : cursor });
			playlists = replace ? page.data : [...playlists, ...page.data];
			cursor = page.next_cursor;
			hasMore = page.has_more;
		} else {
			const page = await listTracks({ limit: 20, cursor: replace ? null : cursor, artistDid });
			tracks = replace ? page.data : [...tracks, ...page.data];
			cursor = page.next_cursor;
			hasMore = page.has_more;
		}
		renderCurrent();
		const count = view === 'playlists' ? playlists.length : tracks.length;
		const noun = view === 'playlists' ? 'playlist' : 'track';
		status.textContent = count === 0 ? `No verified ${noun}s are available in this view.` : `${count} verified ${noun}${count === 1 ? '' : 's'}`;
		loadMore.hidden = !hasMore;
	} catch (error) {
		reportError(error, 'The verified catalog could not be loaded.');
	} finally {
		loading = false;
		loadMore.disabled = false;
	}
}

function renderCurrent() {
	if (playlistDetail) catalog.replaceChildren(...playlistDetail.members.map(renderPlaylistMember));
	else if (view === 'playlists') catalog.replaceChildren(...playlists.map(renderPlaylist));
	else catalog.replaceChildren(...tracks.map(renderTrack));
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

/** @param {import('./api.js').PlaylistSummary} playlist */
function renderPlaylist(playlist) {
	const item = document.createElement('article');
	item.className = 'playlist';
	const body = document.createElement('div');
	const title = document.createElement('h2');
	title.textContent = playlist.metadata.name || 'untitled playlist';
	const owner = playlist.owner.profile?.display_name || playlist.owner.profile?.handle || playlist.owner.did;
	const details = document.createElement('p');
	details.textContent = `${owner} · ${playlist.metrics.member_count} source position${playlist.metrics.member_count === 1 ? '' : 's'}`;
	body.append(title, details);
	const open = document.createElement('button');
	open.className = 'play';
	open.type = 'button';
	open.textContent = 'open';
	open.addEventListener('click', () => selectPlaylist(playlist.id));
	item.append(body, open);
	return item;
}

/** @param {import('./api.js').PlaylistMember} member */
function renderPlaylistMember(member) {
	if (member.availability === 'available' && member.track) return renderTrack(member.track);
	const item = document.createElement('article');
	item.className = 'track unavailable-member';
	const position = document.createElement('span');
	position.className = 'member-position';
	position.textContent = String(member.position + 1).padStart(2, '0');
	const body = document.createElement('div');
	const title = document.createElement('h2');
	title.textContent = 'unavailable source record';
	const details = document.createElement('p');
	details.className = 'track-details';
	details.textContent = member.subject.uri;
	body.append(title, details);
	item.append(position, body);
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
		renderCurrent();
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

/** @param {string} playlistId */
function selectPlaylist(playlistId) {
	const url = new URL(location.href);
	url.search = '';
	url.searchParams.set('playlist', playlistId);
	location.href = url.toString();
}

function clearArtistFilter() {
	const url = new URL(location.href);
	url.search = '';
	if (view === 'playlists') url.searchParams.set('view', 'playlists');
	location.href = url.toString();
}

function setActiveNavigation() {
	if (view === 'tracks') tracksNav.setAttribute('aria-current', 'page');
	else tracksNav.removeAttribute('aria-current');
	if (view === 'playlists') playlistsNav.setAttribute('aria-current', 'page');
	else playlistsNav.removeAttribute('aria-current');
	if (view === 'playlists') heading.textContent = 'verified playlists';
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
audio.addEventListener('pause', renderCurrent);
audio.addEventListener('play', renderCurrent);
void loadInitial();
