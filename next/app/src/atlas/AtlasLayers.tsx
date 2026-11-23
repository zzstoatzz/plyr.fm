import { memo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { faceTint, hueColors, inkOf, lighten, rgba, type HueColors } from '@plyr/next-core/atlas/palette';
import type { AtlasArtist } from '@plyr/next-core/atlas/types';
import { Text } from '../Text';
import type { PreparedAtlas, Scene } from './scene';

const GLOW_STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const FLOOR = Math.exp(-3);

/** a glow's gaussian falloff, drifting core -> mid -> edge as it fades, as on the web */
function glowStops(c: HueColors) {
  return GLOW_STOPS.map(t => {
    const [from, to, f] = t < 0.5 ? [c.core, c.mid, t * 2] : [c.mid, c.edge, (t - 0.5) * 2];
    const color = rgba([0, 1, 2].map(k => Math.round(from[k] + (to[k] - from[k]) * f)) as HueColors['core'], 1);
    return { t, color, opacity: (Math.exp(-3 * t * t) - FLOOR) / (1 - FLOOR) };
  });
}

/** bsky serves a small avatar rendition beside the full one */
const smallAvatar = (url: string) => url.replace('/img/avatar/plain/', '/img/avatar_thumbnail/plain/');

/** The drawn map for one committed view. Pinches and pans move it whole; it is drawn again when they settle. */
export const AtlasLayers = memo(function AtlasLayers({ atlas, scene, fontFamily, background, accent }: { atlas: PreparedAtlas; scene: Scene; fontFamily?: string; background: string; accent: string }) {
  const { width: W, height: H, dark, overscan } = scene.frame;
  const ox = W * overscan;
  const oy = H * overscan;
  const hues = new Map<number, HueColors>();
  const hue = (step: number) => {
    let c = hues.get(step);
    if (!c) hues.set(step, (c = hueColors(step, dark)));
    return c;
  };
  const glowSteps = [...new Set([...scene.regionGlows, ...scene.clusterGlows].map(g => g.step))];
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Svg width={W + 2 * ox} height={H + 2 * oy} viewBox={`${-ox} ${-oy} ${W + 2 * ox} ${H + 2 * oy}`} style={{ position: 'absolute', left: -ox, top: -oy }}>
      <Defs>
        {glowSteps.map(step => <RadialGradient key={step} id={`glow${step}`} cx="50%" cy="50%" r="50%">
          {glowStops(hue(step)).map(s => <Stop key={s.t} offset={s.t} stopColor={s.color} stopOpacity={s.opacity} />)}
        </RadialGradient>)}
      </Defs>
      {scene.regionGlows.length > 0 && <G opacity={scene.regionAlpha}>
        {scene.regionGlows.map(g => <Circle key={g.key} cx={g.x} cy={g.y} r={g.r} fill={`url(#glow${g.step})`} opacity={g.opacity} />)}
      </G>}
      {scene.clusterGlows.length > 0 && <G opacity={scene.clusterAlpha}>
        {scene.clusterGlows.map(g => <Circle key={g.key} cx={g.x} cy={g.y} r={g.r} fill={`url(#glow${g.step})`} opacity={g.opacity} />)}
      </G>}
      {scene.links.map(l => <Path key={l.step} d={l.d} stroke={rgba(hue(l.step).mid, 1)} strokeOpacity={scene.linkAlpha} strokeWidth={scene.linkWidth} fill="none" />)}
      {scene.dots.map(dot => dark
        ? <G key={dot.step} fill="none" strokeLinecap="round">
          <Path d={dot.d} stroke={rgba(hue(dot.step).core, 1)} strokeOpacity={0.28} strokeWidth={scene.haloWidth} />
          <Path d={dot.d} stroke={rgba(lighten(hue(dot.step).core, 0.42), 1)} strokeOpacity={0.9} strokeWidth={scene.dotWidth} />
        </G>
        : <Path key={dot.step} d={dot.d} fill="none" strokeLinecap="round" stroke={rgba(inkOf(hue(dot.step)), 1)} strokeOpacity={0.8} strokeWidth={scene.dotWidth} />)}
    </Svg>
    {scene.covers.map(c => <Image key={c.i} source={{ uri: atlas.data.points[c.i].thumb }} accessibilityIgnoresInvertColors
      style={{ position: 'absolute', left: c.x - c.size / 2, top: c.y - c.size / 2, width: c.size, height: c.size, borderRadius: Math.max(2, c.size * 0.08), opacity: scene.coverAlpha }} />)}
    {scene.faces.map(f => <Face key={atlas.data.artists[f.i].did} artist={atlas.data.artists[f.i]} x={f.x} y={f.y} r={f.r} dark={dark} fontFamily={fontFamily} />)}
    <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
      {scene.selection && <Circle cx={scene.selection.x} cy={scene.selection.y} r={10} fill="none" stroke={accent} strokeWidth={3} />}
      {scene.labels.map(l => <G key={l.key} opacity={l.alpha}>
        <SvgText x={l.x} y={l.y} fontSize={l.size} fontWeight={l.weight} fontFamily={fontFamily} textAnchor="middle" alignmentBaseline="middle"
          stroke={background} strokeWidth={4} strokeLinejoin="round" strokeOpacity={0.85} fill={background}>{l.text}</SvgText>
        <SvgText x={l.x} y={l.y} fontSize={l.size} fontWeight={l.weight} fontFamily={fontFamily} textAnchor="middle" alignmentBaseline="middle"
          fill={dark ? '#f2f2f2' : '#171717'}>{l.text}</SvgText>
      </G>)}
    </Svg>
  </View>;
});

/** an artist's face, or a tinted disk with their initial while it loads or when they have none */
function Face({ artist, x, y, r, dark, fontFamily }: { artist: AtlasArtist; x: number; y: number; r: number; dark: boolean; fontFamily?: string }) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [red, green, blue] = faceTint(artist.did, dark);
  const box = { position: 'absolute' as const, left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: r };
  return <>
    {!shown && <View style={[box, styles.disk, { backgroundColor: `rgb(${red},${green},${blue})` }]}>
      {r >= 8 && <Text style={{ color: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)', fontSize: Math.round(r * 0.9), fontWeight: '600', fontFamily }}>
        {(artist.name || artist.handle || '?').charAt(0).toLowerCase()}
      </Text>}
    </View>}
    {artist.avatar && !failed && <Image source={{ uri: smallAvatar(artist.avatar) }} style={box} accessibilityIgnoresInvertColors
      onLoad={() => setShown(true)} onError={() => setFailed(true)} />}
  </>;
}

const styles = StyleSheet.create({ disk: { alignItems: 'center', justifyContent: 'center' } });
