// Every play button has to know when its own track, album, playlist, artist or station is on, and pause on a
// second press. That decision lives in core/src/play-context.ts; this keeps new buttons from deciding it by hand.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Surfaces that are the player itself: they toggle whatever is on, not a context of their own.
const playerSurfaces = new Map([
  ['web/src/lib/Transport.svelte', 'the dock transport'],
  ['web/src/lib/NowPlaying.svelte', 'the now playing sheet'],
  ['web/src/lib/PlayQueue.svelte', 'the queue page, whose hero is the current track'],
  ['web/src/routes/(app)/+layout.svelte', 'the space bar shortcut'],
  ['web/src/lib/publishing/AudioPreview.svelte', 'an upload preview with its own audio element'],
  ['app/src/NowPlaying.tsx', 'the now playing sheet'],
  ['app/src/PlayerBar.tsx', 'the dock transport'],
  ['app/src/QueueContent.tsx', 'the queue, whose hero is the current track'],
  ['app/src/NowPlayingDetails.tsx', 'chapter rows that seek inside the current track'],
  ['app/src/QueueSuggestions.tsx', 'stack starters: play only shows with nothing on, then a check'],
  ['app/src/RadioEmbed.tsx', 'a station card outside the radio playback scope; it reads its own station'],
]);

function filesIn(directory, pattern) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file, pattern);
    return pattern.test(entry.name) ? [file] : [];
  });
}

const failures = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);

for (const file of filesIn('web/src', /\.(svelte|ts)$/)) {
  if (file === 'web/src/lib/play-control.svelte.ts' || file === 'web/src/lib/player.svelte.ts' || playerSurfaces.has(file)) continue;
  const source = readFileSync(path.join(root, file), 'utf8');
  const usesSeam = /play-control\.svelte|ui\/PlayButton\.svelte|PlayButton\.svelte'/.test(source);
  if (/\bplayer\.toggle\(/.test(source)) fail(file, 'calls player.toggle() directly; use PlayButton or pressContext() so the press knows its context');
  if (/\bcanToggleTrack\(/.test(source)) fail(file, 'decides "is this playing" by hand; use contextState() from $lib/play-control.svelte');
  if (/name=\{[^}]*'pause'/.test(source) && !usesSeam) fail(file, 'swaps a play/pause icon without the shared play state; use PlayButton or contextState()');
  if (/<button[^>]*>\s*<Icon name="play"/.test(source)) fail(file, 'a play button with a fixed play icon never shows pause; use PlayButton');
}

for (const file of filesIn('app/src', /\.tsx?$/)) {
  if (file === 'app/src/playback-context.tsx' || file === 'app/src/playback.tsx' || file === 'app/src/PlayerGlyph.tsx' || file === 'app/src/icons.tsx' || playerSurfaces.has(file)) continue;
  const source = readFileSync(path.join(root, file), 'utf8');
  const usesSeam = /\b(usePlayContext|useTrackPlayback|playState|holdsCurrent)\b/.test(source);
  const drawsPlay = /import\s*\{[^}]*\b(PlayGlyph|Play)\b(\s+as\s+\w+)?[^}]*\}\s*from\s*'\.\/(PlayerGlyph|icons)'/.test(source);
  if (drawsPlay && !usesSeam) fail(file, 'draws a play glyph without the shared play state; use usePlayContext() or PlayPill');
  if (/\bcanToggleTrack\(/.test(source)) fail(file, 'decides "is this playing" by hand; use usePlayContext() or playState()');
}

if (failures.length) {
  console.error('play controls:\n' + failures.map(line => `  ${line}`).join('\n'));
  process.exit(1);
}
console.log('play controls: every play button reads the shared play state');
