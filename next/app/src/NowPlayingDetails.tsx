import type { Href } from 'expo-router';
import { CaretRight as ChevronRight } from './icons';
import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import type { Track } from './api';
import { isPrivateTrack } from './publishing/private-track';
import { useAppearance } from './appearance';
import { Cover, artistName } from './CatalogPieces';
import { Text } from './Text';
import { AccessSummary } from './access/AccessSummary';

export function NowPlayingDetails({ track, plays, protect, navigate }: {
  track: Track; plays: number; protect: ViewProps; navigate: (target: Href) => void;
}) {
  const theme = useAppearance();
  const heading = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 20 * theme.scale, fontWeight: '700' } as const;
  const body = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale } as const;
  const quiet = { color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, lineHeight: 20 * theme.scale } as const;
  const section = [styles.section, { borderColor: theme.line }];
  const { profile } = track.artist;
  const privateTrack = isPrivateTrack(track);
  const likes = track.metrics.like_count;
  const added = new Date(track.metadata.created_at);
  const facts = [`${plays} ${plays === 1 ? 'play' : 'plays'}`, `${likes} ${likes === 1 ? 'like' : 'likes'}`,
    !Number.isNaN(added.getTime()) && `added ${added.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).toLowerCase()}`].filter(Boolean).join(' · ');

  return <View>
    <View testID="now-playing-artist" style={section}>
      <View {...protect}>
        <Pressable accessibilityRole="link" accessibilityLabel={`Artist: ${artistName(track)}`}
          onPress={() => navigate(`/u/${encodeURIComponent(profile.handle || track.artist.did)}`)}
          style={({ pressed }) => [styles.artist, { backgroundColor: pressed ? theme.hover : 'transparent' }]}>
          <Cover uri={profile.avatar_url} size={56} round />
          <View style={styles.text}>
            <Text numberOfLines={1} style={{ ...body, fontSize: 17 * theme.scale, fontWeight: '700' }}>{profile.display_name || profile.handle}</Text>
            {!!profile.handle && <Text numberOfLines={1} style={quiet}>@{profile.handle}</Text>}
          </View>
          <ChevronRight size={20} color={theme.muted} />
        </Pressable>
      </View>
      {profile.bio ? <Text numberOfLines={4} style={{ ...body, color: theme.muted }}>{profile.bio}</Text> : null}
    </View>
    <View testID="now-playing-about" style={section}>
      <Text accessibilityRole="header" aria-level={2} style={heading}>about this track</Text>
      {track.metadata.description ? <Text style={body}>{track.metadata.description}</Text> : null}
      {track.metadata.album ? <Text style={quiet}>from <Text style={{ ...quiet, color: theme.text, fontWeight: '600' }}>{track.metadata.album}</Text></Text> : null}
      {!privateTrack && <Text style={quiet}>{facts}</Text>}
      <AccessSummary track={track} style={quiet} />
      {!privateTrack && <View {...protect} style={{ alignSelf: 'flex-start' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open track page" onPress={() => navigate(`/track/${track.id}`)}
          style={({ pressed }) => [styles.more, { borderColor: theme.border, backgroundColor: pressed ? theme.hover : 'transparent' }]}>
          <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>track page</Text>
        </Pressable>
      </View>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { paddingVertical: 20, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  artist: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderRadius: 10, marginHorizontal: -6, paddingHorizontal: 6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  more: { minHeight: 44, minWidth: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
