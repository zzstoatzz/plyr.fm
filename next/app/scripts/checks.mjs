// The browser checks, what each covers, and which a diff reaches.
//
//   node scripts/checks.mjs              Lists every check with what it needs.
//   node scripts/checks.mjs --affected   Prints the checks the branch's changes reach.
//   node scripts/checks.mjs --affected --base origin/main --run
//
// `covers` is kept by hand: a check is a black box over the web export, so no
// import graph links it to `src/`. `npm run lint` fails when a check is missing here.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const player = [
  /^src\/(Player|NowPlaying|Radio|radio-session|WaveLoading|PlayerFlight)/,
  /^src\/(playback\.tsx|player-sheet|use-player-|now-playing-origin|remote-track-controls|use-remote-track-controls)/,
  /^app\/now-playing/,
];
const playerSet = [
  'check-player-presentation',
  'check-player-navigation',
  'check-player-history',
  'check-player-scrubbing',
  'check-player-transition',
  'check-playback',
  'check-playback-restore',
];
const shared = [
  /^src\/(controls|Text|appearance|colors|materials|CatalogPieces|Sheet|BodyPortal|Toasts|toast|preference-context)\./,
  /^app\/_layout/,
];
const sharedSet = ['check-ui-consistency', 'check-contoured-ui', 'check-player-presentation'];

const checks = {
  'check-account-pages': [/^src\/(AccountCatalog|AccountPieces|ArtistProfile)/, /^app\/(profile|library|liked|playlists|u\/)/],
  'check-album-organization': [/^src\/collections\//, /^app\/(album|create-album)/],
  'check-artist-catalog': [/^src\/(ArtistProfile|Catalog)/, /^app\/u\//],
  'check-artwork-fallback': [/^src\/artwork/, /^src\/TrackPresentation/],
  'check-audio-replacement': [/^src\/publishing\/(TrackEditor|track-audio)/, /^app\/edit-track/],
  'check-audio-seeking': [/^src\/(PlayerSeek|Slider)/, /^src\/playback\.tsx/],
  'check-browser-branding': [/^app\/_layout/, /^public\//, /^src\/appearance/],
  'check-collection-sessions': [/^src\/(collections|CatalogRoute|listening-session)/, /^app\/(album|playlist)/],
  'check-contoured-ui': [/^src\/(controls|materials|ActionRow|DetailHeader)/],
  'check-create-recovery': [/^src\/publishing\/(CreateRecovery|create-)/],
  'check-discovery-preferences': [/^src\/discovery\//, /^app\/settings/],
  'check-downloads': [/^src\/downloads\//],
  'check-feedback': [/^src\/(toast|Toasts|like-interactions|LikeHeart)/],
  'check-font-settings': [/^src\/(Text|appearance|preferences|SettingsPieces)/, /^app\/settings/],
  'check-home': [/^src\/(Home|home-|use-home-|TagScroller|tag-colors|RowActions|DesktopTrackRow)/, /^app\/index/],
  'check-home-artists': [/^src\/(HomeArtists|use-network-artists)/],
  'check-home-feed-pagination': [/^src\/(Home\.|HomeShelf|home-state|home-api)/],
  'check-home-layout': [/^src\/(Home|HomeShelf|HomeChart|HomeTrackRow)/, /^app\/index/],
  'check-home-listening': [/^src\/(Home|listening-session)/],
  'check-home-tag-pagination': [/^src\/(use-home-tags|TagScroller)/],
  'check-jam-accounting': [/^src\/(use-jam-playback|play-reporting|play-metrics)/],
  'check-jam-coordinator': [/^src\/jam-/],
  'check-jam-permissions': [/^src\/jam-/, /^app\/jam/],
  'check-jam-realtime': [/^src\/(jam-|use-jam-playback)/],
  'check-jam-slow-reader': [/^src\/jam-connection/],
  'check-keyboard-shortcuts': [/^src\/KeyboardShortcuts/],
  'check-large-upload': [/^src\/publishing\/(LargeUploads|upload-)/],
  'check-library-creation': [/^src\/(collections|AccountCatalog)/, /^app\/(library|create-album)/],
  'check-login-picker': [/^src\/(AccountPicker|auth|identity)/, /^app\/login/],
  'check-media-session': [/^src\/media-session/],
  'check-overlay-shortcuts': [/^src\/(Sheet|KeyboardShortcuts|behaviors\/(layers|use-layer))/],
  'check-personal-queue-browser': [/^src\/(personal-queue|use-personal-queue|queue-)/],
  'check-personal-queue-coordinator': [/^src\/(personal-queue|queue-)/],
  'check-play-outbox-storage': [/^src\/play-outbox/],
  'check-playback': player,
  'check-playback-accounting': [/^src\/(play-reporting|play-metrics|use-player-accounting|play-listener)/],
  'check-playback-restore': [/^src\/(playback\.tsx|queue-storage|queue-checkpoint)/],
  'check-playback-surfaces': [/^src\/(PlayerBar|NowPlaying|Radio|radio-session)/],
  'check-player-history': player,
  'check-player-navigation': [...player, /^src\/use-player-dismiss/],
  'check-player-presentation': [...player, /^src\/(hints|Coachmark|behaviors\/hints|chapters)/],
  'check-player-scrubbing': [/^src\/(PlayerSeek|Slider)/],
  'check-player-transition': [/^src\/(PlayerFlight|PlayerBar|NowPlaying|player-sheet)/],
  'check-playlist-order': [/^src\/collections\/(CollectionOrder|collection-order|use-collection-order)/, /^app\/playlist/],
  'check-portal-layout': [/^src\/(Portal|use-portal-pages)/, /^app\/portal/],
  'check-private-audio': [/^src\/(gated-audio|private-audio)/],
  'check-private-audio-zds': [/^src\/(gated-audio|private-audio)/],
  'check-private-delete': [/^src\/publishing\/(PrivateTrackDelete|private-delete)/],
  'check-private-publishing': [/^src\/publishing\/(PrivateMusic|private-)/, /^app\/private/],
  'check-protected-downloads': [/^src\/downloads\//, /^src\/gated-audio-shared/],
  'check-profile-editor': [/^src\/profile\//, /^app\/edit-profile/],
  'check-queue-drag': [/^src\/(QueueReorder|HomeTrackRow)/, /^src\/behaviors\/(reorder|use-reorder-handle|use-cancel-on-leave)/, /^app\/queue/],
  'check-queue-sync': [/^src\/(personal-queue|use-personal-queue|queue-)/],
  'check-radio-stations': [/^src\/(radio|Radio|use-radio-feed)/, /^app\/radio/, /^src\/(PlayerBar|NowPlaying)/],
  'check-radio-accounting': [/^src\/(radio|Radio|use-radio-feed)/, /^app\/(radio|embed\/radio)/],
  'check-search-layout': [/^src\/(Search|use-search)/, /^app\/search/],
  'check-settings-search': [/^src\/(SettingsPieces|Search)/, /^app\/settings/],
  'check-short-playback': [/^src\/playback\.tsx/],
  'check-aria-patterns': [/^src\/behaviors\//, /^src\/(ArtistProfile|AccountPieces|AccountPicker|controls)/, /^app\/login/],
  'check-supporter-downloads': [/^src\/downloads\//, /^src\/(auth-config|auth-state|TrackMenu)/],
  'check-tag-scroll-dynamics': [/^src\/TagScroller/],
  'check-track-actions': [/^src\/(TrackMenu|ActionRow|ShareLink|TrackLikes|LikeHeart)/, /^app\/track/],
  'check-track-tags': [/^src\/publishing\/(TagsField|track-tags)/],
  'check-ui-consistency': shared,
  'check-upload-session': [/^src\/publishing\/(Upload|upload-|create-)/, /^app\/upload/],
};

function scriptFor(name) {
  const file = readdirSync(path.join(app, 'scripts')).find(entry => entry.startsWith(name + '.'));
  return file && path.join('scripts', file);
}

function needsOf(name) {
  const source = readFileSync(path.join(app, scriptFor(name)), 'utf8');
  const needs = [...source.matchAll(/require\('\.\/(check-[\w-]+)\.cjs'\)/g)].flatMap(match => needsOf(match[1]));
  if (/\bdist\b|_DIST/.test(source)) {
    needs.push('web export');
  }
  if (source.includes('pds-browser-fixture') || source.includes(':5197')) {
    needs.push('local PDS');
  }
  if (source.includes("require('./queue-fixture.cjs')") || source.includes('REDIS_URL')) {
    needs.push('compose redis + postgres');
  }
  return [...new Set(needs)];
}

function changedFiles(base) {
  const committed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: app, encoding: 'utf8' });
  const working = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: app, encoding: 'utf8' });
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: app, encoding: 'utf8' }).trim();
  return [...new Set([...committed.split('\n'), ...working.split('\n')])]
    .filter(file => file.startsWith(prefix))
    .map(file => file.slice(prefix.length));
}

function affected(files) {
  const plan = new Set();
  const unmapped = [];
  for (const file of files.filter(file => /^(src|app|public)\//.test(file))) {
    let reached = false;
    for (const [name, patterns] of Object.entries(checks)) {
      if (patterns.some(pattern => pattern.test(file))) {
        plan.add(name);
        reached = true;
      }
    }
    if (player.some(pattern => pattern.test(file))) {
      playerSet.forEach(name => plan.add(name));
    }
    if (shared.some(pattern => pattern.test(file))) {
      sharedSet.forEach(name => plan.add(name));
    }
    if (!reached) {
      unmapped.push(file);
    }
  }
  return { plan: [...plan].sort(), unmapped };
}

function main() {
  const { values } = parseArgs({
    options: {
      affected: { type: 'boolean' },
      base: { type: 'string', default: 'origin/main' },
      run: { type: 'boolean' },
    },
  });
  if (!values.affected) {
    for (const name of Object.keys(checks)) {
      console.log(`${name.padEnd(34)} ${needsOf(name).join(', ') || 'nothing extra'}`);
    }
    return;
  }
  const { plan, unmapped } = affected(changedFiles(values.base));
  for (const file of unmapped) {
    console.log(`no check covers ${file}; pick one by hand or add it to scripts/checks.mjs`);
  }
  if (plan.length === 0) {
    console.log('no browser checks reached');
    return;
  }
  for (const name of plan) {
    console.log(`${scriptFor(name)}  (${needsOf(name).join(', ') || 'nothing extra'})`);
  }
  if (!values.run) {
    return;
  }
  let failed = 0;
  for (const name of plan) {
    const result = spawnSync(process.execPath, [scriptFor(name)], { cwd: app, stdio: 'inherit' });
    console.log(`${name}: exit ${result.status}`);
    failed += result.status === 0 ? 0 : 1;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { checks, scriptFor };
