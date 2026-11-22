import { Link, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { Artist, ArtistMetrics, Track } from '@plyr/next-core/api';
import { trackArtwork } from '@plyr/next-core/artwork';
import { useAppearance } from './appearance';
import { BLEED, Chip, HeroBackdrop, Pill, PlayPill, Round, TOP, shuffled } from './HeroPieces';
import { artistContext } from '@plyr/next-core/play-context';
import { Cover } from './CatalogPieces';
import { ListeningNowStatus } from './ListeningNow';
import { catalogRuntime } from '@plyr/next-core/catalog/runtime';
import { compactCount } from './home-state';
import { CaretRight, Heart, PencilSimple, ShareNetwork, Shuffle } from './icons';
import { Text } from './Text';
import { toast } from './toast';

const AVATAR = 116;

/** "ko-fi.com/name" rather than "https://www.ko-fi.com/name/". */
export function supportLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

export function ArtistHero({ artist, tracks, metrics, owner, onPlay, onShare, footer }: {
  artist: Artist; tracks: Track[]; metrics: ArtistMetrics | null; owner: boolean;
  onPlay: (track: Track, queue: Track[]) => void; onShare: () => void; footer?: ReactNode;
}) {
  const theme = useAppearance();
  const { fontScale } = useWindowDimensions();
  const icon = (size: number) => Math.round(size * Math.min(fontScale * theme.scale, 1.6));
  const name = artist.display_name || artist.handle;
  const support = /^https?:\/\//i.test(artist.support_url ?? '') ? artist.support_url! : null;
  const top = metrics?.top_track ?? null;
  const topArt = top ? tracks.find(track => track.id === top.id) : undefined;
  const totals = metrics?.totals;
  const backdrop = Math.round(TOP + 28 + AVATAR * 1.6);
  return <View style={{ marginHorizontal: -BLEED, marginTop: -TOP, paddingHorizontal: BLEED, paddingTop: TOP + 28 }}>
    {artist.avatar_url ? <HeroBackdrop uri={artist.avatar_url} height={backdrop} /> : null}

    <View style={styles.identity}>
      <View style={{ borderRadius: AVATAR / 2, boxShadow: theme.dark ? '0px 10px 30px #0000008c' : '0px 10px 30px #00000038' }}>
        <Cover uri={artist.avatar_url} size={AVATAR} round />
      </View>
      <Text accessibilityRole="header" aria-level={1} numberOfLines={2} style={{ marginTop: 14, color: theme.text, fontFamily: theme.fontFamily,
        fontSize: 30 * theme.scale, lineHeight: 36 * theme.scale, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' }}>{name}</Text>
      {artist.display_name && artist.display_name !== artist.handle ? <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, textAlign: 'center' }}>@{artist.handle}</Text> : null}
      <ListeningNowStatus did={artist.did} name={name} />
      {artist.bio ? <Text style={{ marginTop: 12, color: theme.muted, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale, textAlign: 'center' }}>{artist.bio}</Text> : null}
    </View>

    {totals ? <View style={styles.chips} accessibilityRole="summary">
      <Chip value={totals.plays.toLocaleString()} label={totals.plays === 1 ? 'play' : 'plays'} />
      <Chip value={totals.tracks.toLocaleString()} label={totals.tracks === 1 ? 'track' : 'tracks'} />
      {totals.duration_seconds > 0 ? <Chip value={catalogRuntime(totals.duration_seconds)} label="of audio" /> : null}
    </View> : null}

    <View style={styles.controls}>
      {tracks[0] ? <PlayPill context={artistContext(artist.did)} name={name} iconSize={icon(18)} start={() => onPlay(tracks[0], tracks)} /> : null}
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
  identity: { alignItems: 'center', gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  cards: { gap: 8, marginTop: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  lead: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
