import { Link, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, Linking, PixelRatio, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Artist, ArtistMetrics, Track } from '@plyr/next-core/api';
import { displayUrl, trackArtwork } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { catalogRuntime } from './CatalogMetrics';
import { compactCount } from './home-state';
import { CaretRight, Heart, PencilSimple, Play as PlayIcon, ShareNetwork, Shuffle } from './icons';
import { Text } from './Text';
import { toast } from './toast';

/** The page column pads 20 on each side and 16 on top; the hero bleeds past that. */
const BLEED = 20;
const TOP = 16;
const AVATAR = 116;
const CONTROL = 48;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** "ko-fi.com/name" rather than "https://www.ko-fi.com/name/". */
export function supportLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

export function ArtistHero({ artist, tracks, metrics, owner, onPlay, onShare, footer }: {
  artist: Artist; tracks: Track[]; metrics: ArtistMetrics | null; owner: boolean;
  onPlay: (track: Track, queue: Track[]) => void; onShare: () => void; footer?: ReactNode;
}) {
  const theme = useAppearance();
  const { width, fontScale } = useWindowDimensions();
  const icon = (size: number) => Math.round(size * Math.min(fontScale * theme.scale, 1.6));
  const name = artist.display_name || artist.handle;
  const support = /^https?:\/\//i.test(artist.support_url ?? '') ? artist.support_url! : null;
  const top = metrics?.top_track ?? null;
  const topArt = top ? tracks.find(track => track.id === top.id) : undefined;
  const totals = metrics?.totals;
  const backdrop = Math.round(TOP + 28 + AVATAR * 1.6);
  return <View style={{ marginHorizontal: -BLEED, marginTop: -TOP, paddingHorizontal: BLEED, paddingTop: TOP + 28 }}>
    {artist.avatar_url ? <View aria-hidden pointerEvents="none" style={[styles.backdrop, { height: backdrop }]}>
      <Backdrop uri={artist.avatar_url} opacity={theme.dark ? 0.6 : 0.7} />
      <Svg style={StyleSheet.absoluteFill} width={width} height={backdrop}>
        <Defs><LinearGradient id="artist-hero-fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor={theme.background} stopOpacity={1} />
          <Stop offset={0.28} stopColor={theme.background} stopOpacity={0} />
          <Stop offset={0.72} stopColor={theme.background} stopOpacity={0.8} />
          <Stop offset={1} stopColor={theme.background} stopOpacity={1} />
        </LinearGradient></Defs>
        <Rect width="100%" height="100%" fill="url(#artist-hero-fade)" />
      </Svg>
    </View> : null}

    <View style={styles.identity}>
      <View style={{ borderRadius: AVATAR / 2, boxShadow: theme.dark ? '0px 10px 30px #0000008c' : '0px 10px 30px #00000038' }}>
        <Cover uri={artist.avatar_url} size={AVATAR} round />
      </View>
      <Text accessibilityRole="header" aria-level={1} numberOfLines={2} style={{ marginTop: 14, color: theme.text, fontFamily: theme.fontFamily,
        fontSize: 30 * theme.scale, lineHeight: 36 * theme.scale, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' }}>{name}</Text>
      {artist.display_name && artist.display_name !== artist.handle ? <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, textAlign: 'center' }}>@{artist.handle}</Text> : null}
      {artist.bio ? <Text style={{ marginTop: 12, color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale, textAlign: 'center' }}>{artist.bio}</Text> : null}
    </View>

    {totals ? <View style={styles.chips} accessibilityRole="summary">
      <Chip value={totals.plays.toLocaleString()} label={totals.plays === 1 ? 'play' : 'plays'} />
      <Chip value={totals.tracks.toLocaleString()} label={totals.tracks === 1 ? 'track' : 'tracks'} />
      {totals.duration_seconds > 0 ? <Chip value={catalogRuntime(totals.duration_seconds)} label="of music" /> : null}
    </View> : null}

    <View style={styles.controls}>
      {tracks[0] ? <Pill primary icon={<PlayIcon size={icon(18)} color={theme.onAccent} fill={theme.onAccent} />} label="Play"
        accessibilityLabel={`Play ${name}`} onPress={() => onPlay(tracks[0], tracks)} /> : null}
      {tracks.length > 1 ? <Pill icon={<Shuffle size={icon(19)} color={theme.text} />} label="Shuffle"
        accessibilityLabel={`Shuffle ${name}`} onPress={() => { const order = shuffled(tracks); onPlay(order[0], order); }} /> : null}
      {owner ? <Round label="Edit profile" href="/edit-profile"><PencilSimple size={icon(20)} color={theme.text} /></Round> : null}
      <Round label="Share" onPress={onShare}><ShareNetwork size={icon(20)} color={theme.text} /></Round>
    </View>

    {support || top ? <View style={styles.cards}>
      {support ? <InfoCard eyebrow={`support ${name}`} title={supportLabel(support)} accessibilityLabel={`Support ${name} at ${supportLabel(support)}`}
        onPress={() => void Linking.openURL(support).catch(() => toast.error('couldn’t open that link'))}
        lead={<View style={[styles.lead, { borderRadius: 20, backgroundColor: theme.accent + '26' }]}><Heart size={20} color={theme.accent} /></View>} />
        : null}
      {top ? <InfoCard eyebrow="most played" title={top.title} meta={`${compactCount(top.play_count)} ${top.play_count === 1 ? 'play' : 'plays'}`}
        href={{ pathname: '/track/[id]', params: { id: top.id } }} accessibilityLabel={`Most played: ${top.title}`}
        lead={<Cover uri={topArt ? trackArtwork(topArt) : null} size={40} radius={6} />} /> : null}
    </View> : null}
    {footer}
  </View>;
}

/** A small rendition is plenty under a heavy blur; the original is the fallback. */
function Backdrop({ uri, opacity }: { uri: string; opacity: number }) {
  // iOS can't blur bsky's transparent WebP avatars (the blur fails silently), so ask its CDN for a JPEG.
  const opaque = /^https:\/\/cdn\.bsky\.app\//.test(uri) ? uri.replace(/@(webp|png|jpeg)$/i, '') + '@jpeg' : null;
  const sources = [...new Set([opaque ?? displayUrl(uri, 160, PixelRatio.get()), uri])];
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return null;
  return <Image aria-hidden source={{ uri: sources[index] }} blurRadius={40} resizeMode="cover" onError={() => setIndex(index + 1)}
    style={[StyleSheet.absoluteFill, { opacity, transform: [{ scale: 1.3 }] }]} />;
}

function Chip({ value, label }: { value: string; label: string }) {
  const theme = useAppearance();
  return <View accessible accessibilityLabel={`${value} ${label}`} style={[styles.chip, { backgroundColor: theme.raised }]}>
    <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13.5 * theme.scale, fontVariant: ['tabular-nums'] }}>
      <Text style={{ color: theme.text, fontWeight: '700' }}>{value}</Text> {label}
    </Text>
  </View>;
}

function Pill({ icon, label, accessibilityLabel, onPress, primary }: {
  icon: ReactNode; label: string; accessibilityLabel: string; onPress: () => void; primary?: boolean;
}) {
  const theme = useAppearance();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
    style={({ pressed }) => [styles.pill, { backgroundColor: primary ? theme.accent : theme.raised, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    {icon}
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 1, color: primary ? theme.onAccent : theme.text, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

function Round({ label, onPress, href, children }: { label: string; onPress?: () => void; href?: Href; children: ReactNode }) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  const control = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityLabel={label} onPress={onPress}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.round, { backgroundColor: theme.raised, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }])}>
    {children}
  </Pressable>;
  return href ? <Link href={href} asChild>{control}</Link> : control;
}

function InfoCard({ eyebrow, title, meta, lead, href, onPress, accessibilityLabel }: {
  eyebrow: string; title: string; meta?: string; lead: ReactNode; accessibilityLabel: string; href?: Href; onPress?: () => void;
}) {
  const theme = useAppearance();
  const [pressed, setPressed] = useState(false);
  // `<Link asChild>` drops style functions and throws on style arrays in dev, so pass one flat object.
  const card = <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel} onPress={onPress}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.card, { backgroundColor: pressed ? theme.hover : theme.raised }])}>
    {lead}
    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
      <Text numberOfLines={1} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 12 * theme.scale, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' }}>{eyebrow}</Text>
      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{title}</Text>
    </View>
    {meta ? <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, fontVariant: ['tabular-nums'] }}>{meta}</Text> : null}
    <CaretRight size={14} color={theme.faint} />
  </Pressable>;
  return href ? <Link href={href} asChild>{card}</Link> : card;
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  identity: { alignItems: 'center', gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  pill: { flex: 1, minHeight: CONTROL, paddingHorizontal: 14, borderRadius: CONTROL / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  round: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, alignItems: 'center', justifyContent: 'center' },
  cards: { gap: 8, marginTop: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  lead: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
