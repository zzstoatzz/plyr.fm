import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { atlasSummary, loadAtlas } from '@plyr/next-core/atlas/load';
import { api } from '../api-client';
import { fitView, type AtlasView } from '@plyr/next-core/atlas/view';
import { useAppearance } from '../appearance';
import { Status, useResource } from '../CatalogPieces';
import { Round } from '../HeroPieces';
import { Minus, Plus } from '../icons';
import { glassSurface } from '../materials';
import { Text } from '../Text';
import { AtlasLayers } from './AtlasLayers';
import { AtlasSelection } from './AtlasSelection';
import { between, keepOnMap, panBy, pinchBy, settle, still, strayed, type Live } from './camera';
import { buildScene, hitTest, prepareAtlas, type PreparedAtlas, type Rect } from './scene';

const OVERSCAN = 0.3;
const fetchAtlas = () => loadAtlas(api.atlas);

export default function Atlas() {
  const theme = useAppearance();
  const result = useResource(fetchAtlas);
  const atlas = useMemo(() => result.data && prepareAtlas(result.data), [result.data]);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [free, setFree] = useState<{ y: number; height: number }>();
  const [header, setHeader] = useState<Rect>();
  const clear = useMemo(() => size && free && header ? { top: header.y + header.h, bottom: Math.max(0, size.height - free.y - free.height), header } : undefined, [size, free, header]);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(old => old?.width === width && old.height === height ? old : { width, height });
  };
  return <View style={[styles.fill, { backgroundColor: theme.background }]} onLayout={onLayout}>
    {atlas && size && clear ? <AtlasMap key={`${size.width}x${size.height}`} atlas={atlas} width={size.width} height={size.height} clear={clear} />
      : <View style={styles.notice}><Status loading={!result.error} error={result.error && 'could not load the atlas.'} retry={result.retry} /></View>}
    {/* the space the tab bar and player leave free, measured so overlays and the opening view keep clear of them */}
    <SafeAreaView edges={['bottom']} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.fill} onLayout={event => {
        const { y, height } = event.nativeEvent.layout;
        setFree(old => old?.y === y && old.height === height ? old : { y, height });
      }} />
    </SafeAreaView>
    <View pointerEvents="none" style={styles.header} onLayout={event => {
      const { x, y, width: w, height: h } = event.nativeEvent.layout;
      setHeader(old => old?.x === x && old.y === y && old.w === w && old.h === h ? old : { x, y, w, h });
    }}>
      <View style={[StyleSheet.absoluteFill, styles.chip, { backgroundColor: theme.background }]} />
      <Text accessibilityRole="header" aria-level={1} style={[styles.title, { color: theme.text, fontSize: 28 * theme.scale, textShadowColor: theme.background }]}>atlas</Text>
      <Text style={{ color: theme.muted, fontSize: 13 * theme.scale, textShadowColor: theme.background, textShadowRadius: 8 }}>
        {result.data ? atlasSummary(result.data) : 'the catalog, mapped by sound'}
      </Text>
    </View>
  </View>;
}

function AtlasMap({ atlas, width, height, clear }: { atlas: PreparedAtlas; width: number; height: number; clear: { top: number; bottom: number; header: Rect } }) {
  const theme = useAppearance();
  const [view, setView] = useState<AtlasView>(() => fitView(atlas.xs, atlas.ys, width, height, clear.top, clear.bottom + 64));
  const moved = useRef(false);
  // the tab bar's inset can land a layout pass late: keep the opening view clear of it until the person moves the map
  useEffect(() => {
    if (!moved.current) setView(fitView(atlas.xs, atlas.ys, width, height, clear.top, clear.bottom + 64));
  }, [atlas, width, height, clear.top, clear.bottom]);
  const [live, setLive] = useState<Live>(still);
  const [selected, setSelected] = useState(-1);
  const state = useRef<{ view: AtlasView; live: Live; frame: number; glide: number; drawn: number; aim?: Live }>({ view, live, frame: 0, glide: 0, drawn: 0 });
  state.current.view = view;

  const [pill, setPill] = useState({ w: 0, h: 0 });
  // labels keep out from under the title chip and the zoom pill
  const keepOut = useMemo(() => [clear.header, { x: width - 12 - pill.w, y: height - clear.bottom - 12 - pill.h, w: pill.w, h: pill.h }], [clear, width, height, pill]);
  const scene = useMemo(() => buildScene(atlas, { width, height, view, dark: theme.dark, overscan: OVERSCAN, selected, keepOut }), [atlas, width, height, view, theme.dark, selected, keepOut]);

  /** draw the moved map again at rest, in the same render that drops the move */
  const commit = useCallback(() => {
    const s = state.current;
    if (s.live === still) return;
    moved.current = true;
    s.drawn = Date.now();
    s.view = keepOnMap(settle(s.view, s.live, width, height), atlas.bounds);
    s.live = still;
    setView(s.view);
    setLive(still);
  }, [atlas, width, height]);

  const move = useCallback((next: Live) => {
    moved.current = true;
    const s = state.current;
    s.live = next;
    // zooming out strays on nearly every update, so mid-gesture redraws wait a beat; an edge may show for that long
    if (strayed(next, width, height, OVERSCAN) && Date.now() - s.drawn > 120) return commit();
    if (s.frame) return;
    s.frame = requestAnimationFrame(() => { s.frame = 0; setLive(s.live); });
  }, [width, height, commit]);

  const stopGlide = useCallback(() => {
    if (state.current.glide) cancelAnimationFrame(state.current.glide);
    state.current.glide = 0;
    state.current.aim = undefined;
  }, []);

  /** ease the camera to `to`, then draw it at rest */
  const animateTo = useCallback((to: Live) => {
    stopGlide();
    const from = state.current.live;
    state.current.aim = to;
    if (theme.reduceMotion) { state.current.aim = undefined; state.current.live = to; commit(); return; }
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / 260);
      state.current.live = between(from, to, t);
      setLive(state.current.live);
      if (t < 1) state.current.glide = requestAnimationFrame(step);
      else { state.current.glide = 0; state.current.aim = undefined; commit(); }
    };
    state.current.glide = requestAnimationFrame(step);
  }, [theme.reduceMotion, commit, stopGlide]);

  /** a flung pan keeps going and slows, like a native scroll view */
  const glide = useCallback((vx: number, vy: number) => {
    stopGlide();
    if (theme.reduceMotion || Math.hypot(vx, vy) < 120) return commit();
    let last = Date.now();
    const step = () => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const decay = Math.exp(-dt / 0.33);
      vx *= decay;
      vy *= decay;
      move(panBy(state.current.live, vx * dt, vy * dt));
      const at = settle(state.current.view, state.current.live, width, height);
      if (keepOnMap(at, atlas.bounds) !== at) vx = vy = 0;
      if (Math.hypot(vx, vy) > 20) state.current.glide = requestAnimationFrame(step);
      else { state.current.glide = 0; commit(); }
    };
    state.current.glide = requestAnimationFrame(step);
  }, [atlas, width, height, theme.reduceMotion, move, commit, stopGlide]);

  /** zoom by `factor` about (x, y); a press while one is easing builds on where that one was heading */
  const zoomAt = useCallback((factor: number, x = width / 2, y = height / 2) => {
    const s = state.current;
    animateTo(pinchBy(s.aim ?? s.live, factor, x, y, s.view.zoom));
  }, [width, height, animateTo]);

  const tapAt = useCallback((x: number, y: number) => {
    stopGlide();
    commit();
    // a touch that stopped a glide only stops it, like a scroll view
    if (caught.current) { caught.current = false; return; }
    const hit = hitTest(atlas, { width, height, view: state.current.view }, x, y);
    if (hit && 'artist' in hit) {
      const artist = atlas.data.artists[hit.artist];
      router.push({ pathname: '/u/[handle]', params: { handle: artist.handle || artist.did } });
    } else setSelected(hit ? hit.point : -1);
  }, [atlas, width, height, commit, stopGlide]);

  const caught = useRef(false);
  const pan = useRef({ x: 0, y: 0, at: 0 });
  const pinch = useRef(1);
  const pinching = useRef(false);
  const panGesture = usePanGesture({
    runOnJS: true, maxPointers: 2,
    onBegin: () => { caught.current = !!state.current.glide; stopGlide(); pan.current = { x: 0, y: 0, at: 0 }; },
    onUpdate: event => {
      const dx = event.translationX - pan.current.x;
      const dy = event.translationY - pan.current.y;
      pan.current = { x: event.translationX, y: event.translationY, at: Date.now() };
      move(panBy(state.current.live, dx, dy));
    },
    // a finger held still before lifting reports a stale velocity; it shouldn't fling
    onDeactivate: event => {
      if (pinching.current) return;
      const fresh = Date.now() - pan.current.at < 80;
      glide(fresh ? event.velocityX : 0, fresh ? event.velocityY : 0);
    }
  });
  const pinchGesture = usePinchGesture({
    runOnJS: true,
    onActivate: () => { stopGlide(); pinching.current = true; pinch.current = 1; },
    onUpdate: event => {
      const ds = event.scale / pinch.current;
      pinch.current = event.scale;
      move(pinchBy(state.current.live, ds, event.focalX, event.focalY, state.current.view.zoom));
    },
    onDeactivate: () => { pinching.current = false; commit(); }
  });
  const doubleTap = useTapGesture({ runOnJS: true, numberOfTaps: 2, maxDistance: 10, onActivate: event => zoomAt(2, event.x, event.y) });
  const tap = useTapGesture({ runOnJS: true, maxDistance: 10, onActivate: event => tapAt(event.x, event.y) });
  const taps = useExclusiveGestures(doubleTap, tap);
  // taps wait for a drag or pinch to fail, so a quick flick never lands as a tap
  const gestures = useExclusiveGestures(useSimultaneousGestures(panGesture, pinchGesture), taps);

  useEffect(() => () => { stopGlide(); cancelAnimationFrame(state.current.frame); }, [stopGlide]);
  useEffect(() => {
    if (selected >= 0) AccessibilityInfo.announceForAccessibility(`${atlas.data.points[selected].title}, by ${atlas.data.points[selected].artist}`);
  }, [atlas, selected]);

  return <>
    <GestureDetector gesture={gestures}>
      <View collapsable={false} style={styles.fill} accessible accessibilityLabel="Catalog atlas"
        accessibilityHint="pinch to zoom, drag to move around, and tap a track to select it">
        <View style={[StyleSheet.absoluteFill, { transformOrigin: 'left top', transform: [{ translateX: live.tx }, { translateY: live.ty }, { scale: live.s }] }]}>
          <AtlasLayers atlas={atlas} scene={scene} fontFamily={theme.fontFamily} background={theme.background} accent={theme.accent} />
        </View>
      </View>
    </GestureDetector>
    <View pointerEvents="box-none" style={[styles.controls, { bottom: clear.bottom + 12 }]}>
      {selected >= 0 ? <AtlasSelection key={selected} point={atlas.data.points[selected]} onClose={() => setSelected(-1)} />
        : <View style={styles.flex} />}
      <View style={[styles.zoom, glassSurface(theme)]} onLayout={event => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setPill(old => old.w === w && old.h === h ? old : { w, h });
      }}>
        <Round label="Zoom in" onPress={() => zoomAt(1.5)}><Plus size={20} color={theme.text} /></Round>
        <Round label="Zoom out" onPress={() => zoomAt(1 / 1.5)}><Minus size={20} color={theme.text} /></Round>
      </View>
    </View>
  </>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  flex: { flex: 1 },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { position: 'absolute', top: 8, left: 12, alignSelf: 'flex-start', maxWidth: '80%', gap: 2, paddingHorizontal: 12, paddingVertical: 8 },
  chip: { borderRadius: 16, opacity: 0.88 },
  title: { fontWeight: '800', letterSpacing: -0.8, textShadowRadius: 10 },
  controls: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  zoom: { borderRadius: 28, padding: 4, gap: 4 }
});
