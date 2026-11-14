import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from '../api';
import { useAppearance } from '../appearance';
import { glassSurface } from '../materials';
import { Text } from '../Text';
import { toast } from '../toast';
import { atlasSummary, atlasTrack, loadAtlas } from './atlas-api';
import { AtlasRenderer } from './renderer';
import type { AtlasData } from './types';

type Tip = { x: number; y: number; title: string; meta: string; hint: string };

export function AtlasView({ preview = false, onPlay, onSummary }: { preview?: boolean; onPlay?: (track: Track) => void; onSummary?: (summary: string) => void }) {
  const theme = useAppearance();
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<AtlasRenderer | null>(null);
  const [data, setData] = useState<AtlasData>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [tip, setTip] = useState<Tip>();
  const [starting, setStarting] = useState<string>();
  const play = useRef(onPlay);
  play.current = onPlay;
  const pending = useRef<AbortController | null>(null);
  const start = useCallback((id: number, title: string) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStarting(title);
    atlasTrack(id, controller.signal).then(track => { if (!controller.signal.aborted) play.current?.(track); },
      () => { if (!controller.signal.aborted) toast.error(`couldn't start ${title}`); })
      .finally(() => { if (pending.current === controller) { pending.current = null; setStarting(undefined); } });
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const place = (x: number, y: number) => ({ x: x + 260 + 16 > node.clientWidth ? Math.max(8, x - 276) : x + 16, y: Math.max(8, y - 60) });
    const instance = new AtlasRenderer(node, {
      onHover: (point, x, y) => setTip(point ? { ...place(x, y), title: point.title, meta: `${point.artist} · ${point.plays} ${point.plays === 1 ? 'play' : 'plays'}`, hint: 'click to play' } : undefined),
      onHoverArtist: (artist, x, y) => setTip(artist ? { ...place(x, y), title: artist.name, meta: `@${artist.handle} · ${artist.count} tracks`, hint: 'click for profile' } : undefined),
      onActivate: point => start(point.id, point.title),
      onActivateArtist: artist => router.push({ pathname: '/u/[handle]', params: { handle: artist.handle } }),
    }, { dark: theme.dark, preview });
    renderer.current = instance;
    return () => { instance.destroy(); renderer.current = null; pending.current?.abort(); };
  }, [preview, start]);
  useEffect(() => { renderer.current?.setDark(theme.dark); }, [theme.dark]);
  useEffect(() => {
    let live = true;
    setError(undefined);
    loadAtlas().then(next => { if (live) setData(next); }, (cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "couldn't load the atlas"); });
    return () => { live = false; };
  }, [attempt]);
  useEffect(() => {
    if (!data) return;
    renderer.current?.setData(data);
    onSummary?.(atlasSummary(data));
  }, [data, onSummary]);
  function key(event: KeyboardEvent<HTMLCanvasElement>) {
    const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[event.key]) renderer.current?.panBy(...moves[event.key]);
    else if (event.key === '+' || event.key === '=') renderer.current?.zoomBy(1.25);
    else if (event.key === '-' || event.key === '_') renderer.current?.zoomBy(0.8);
    else return;
    event.preventDefault();
  }
  const label = data ? `Atlas of ${atlasSummary(data)}. Arrow keys pan, plus and minus zoom.` : 'Atlas';
  return <View style={[styles.stage, { backgroundColor: theme.background }]}>
    {preview ? <canvas ref={canvas} aria-hidden style={{ position: 'absolute', left: 0, top: 0, display: 'block', pointerEvents: 'none' }} />
      : <canvas ref={canvas} tabIndex={0} aria-label={label} onKeyDown={key} style={{ position: 'absolute', left: 0, top: 0, display: 'block', touchAction: 'none', outlineOffset: -2 }} />}
    {!data && <View style={styles.center} pointerEvents="box-none">
      {error ? <>
        <Text style={{ color: theme.muted, fontSize: 14 * theme.scale }}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={styles.retry}><Text style={{ color: theme.accent, fontSize: 14 * theme.scale, fontWeight: '600' }}>try again</Text></Pressable>
      </> : <Text accessibilityRole="progressbar" style={{ color: theme.faint, fontSize: 13 * theme.scale }}>charting the catalog…</Text>}
    </View>}
    {starting && <View pointerEvents="none" style={[styles.starting, glassSurface(theme)]}><Text numberOfLines={1} style={{ color: theme.text, fontSize: 12 * theme.scale }}>starting {starting}…</Text></View>}
    {tip && <View pointerEvents="none" style={[styles.tip, glassSurface(theme), { left: tip.x, top: tip.y }]}>
      <Text numberOfLines={2} style={{ color: theme.text, fontSize: 13 * theme.scale, fontWeight: '600' }}>{tip.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 * theme.scale }}>{tip.meta}</Text>
      <Text style={{ color: theme.faint, fontSize: 11 * theme.scale }}>{tip.hint}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  stage: { flex: 1, position: 'relative', overflow: 'hidden' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 4 },
  retry: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 12 },
  starting: { position: 'absolute', left: 12, bottom: 12, maxWidth: '80%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  tip: { position: 'absolute', width: 260, borderRadius: 10, padding: 10, gap: 2 },
});
