import { displayUrl, trackArtwork } from '@plyr/next-core/artwork';
import { X } from './icons';
import { Text } from './Text';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, PixelRatio, Pressable, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { playerSheet, useFlying } from './player-sheet';
import { NextGlyph as SkipForward, PauseGlyph as Pause, PlayGlyph as Play } from './PlayerGlyph';
import { useAppearance } from './appearance';
import { usePlayback } from './playback';
import { Cover, artistName } from './CatalogPieces';
import { glassSurface } from './materials';
import { TrackLikes } from './TrackLikes';
import { NowPlaying } from './NowPlaying';
import { PlayerControl } from './PlayerControl';
import { useRadio } from './radio-session';

export function PlayerBar() {
  const player = usePlayback();
  const radio = useRadio();
  const theme = useAppearance();
  const path = usePathname();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [path]);
  const flying = useFlying();
  const dock = useRef<ViewInstance>(null);
  const present = !!player.current;
  useEffect(() => {
    if (!present || width >= 600) { playerSheet.dockTop = undefined; return; }
    const frame = requestAnimationFrame(() => dock.current?.measureInWindow((_x, y, _width, tall) => {
      if (tall <= 0) return;
      playerSheet.dockTop = y;
      if (!playerSheet.modal) playerSheet.translation.setValue(y);
    }));
    return () => cancelAnimationFrame(frame);
  }, [present, width, height, theme.scale, path]);
  const art = player.current ? trackArtwork(player.current) : undefined;
  useEffect(() => {
    // Native mounts now playing on open; warm the size it draws the cover at.
    if (art) Image.prefetch(displayUrl(art, Math.min(width - 40, 372), PixelRatio.get())).catch(() => {});
  }, [art, width]);
  const [expandRequested, setExpandRequested] = useState(false);
  useEffect(() => {
    playerSheet.expand = () => setExpandRequested(true);
    return () => { playerSheet.expand = undefined; };
  }, []);
  useEffect(() => {
    // A request from outside the dock can land in the same commit that first shows the track; open once the dock has a place.
    if (!expandRequested || !present) return;
    setExpandRequested(false);
    setExpanded(true);
  }, [expandRequested, present]);
  const carried = flying ? { opacity: 0 } : undefined;
  if (!player.current) return null;
  const track = player.current;
  const playing = player.status.playing;
  const play = <PlayerControl primary label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play}
    onPress={() => player.setPlaying(!playing)} busy={player.loading} />;
  const error = player.error ?? player.status.error;
  const stopRadio = <PlayerControl label="Stop radio" icon={X} onPress={radio.stop} />;
  const identity = <Pressable accessibilityRole="button" accessibilityLabel="Open now playing" onPress={() => setExpanded(true)}
    style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
    <View ref={node => { playerSheet.dock.art = node; }} style={carried}><Cover uri={trackArtwork(track)} size={40} radius={6} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <View ref={node => { playerSheet.dock.title = node; }} style={carried}><Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 * theme.scale, fontWeight: '700' }}>{track.metadata.title}</Text></View>
      <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{error ? "couldn’t play this track" : player.outputElsewhere ? "playing on another device" : player.live ? `${artistName(track)} · ${player.live.station.label} radio` : artistName(track)}</Text>
    </View>
  </Pressable>;
  return <>
    <View ref={dock} testID="player-dock" style={[glassSurface(theme), {
      borderWidth: 0, borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 4, overflow: 'hidden'
    }]}>
      <View pointerEvents="none" accessible={false} testID="playback-status-inlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        opacity: playing ? 0.65 : 0.16, backgroundColor: theme.accent,
        boxShadow: `0px 0px 5px ${theme.accent}66` }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}>{identity}{!player.privatePlayback && <TrackLikes key={track.id} track={track} iconOnly returnTo={path} />}</View>
        {play}{player.live ? stopRadio : <PlayerControl label="Next" icon={SkipForward} onPress={() => void player.next()} />}
      </View>
    </View>
    {expanded && <NowPlaying track={track} close={() => setExpanded(false)} navigate={target => { setExpanded(false); router.push(target); }} />}
  </>;
}
