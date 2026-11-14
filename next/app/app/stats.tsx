import { View, useWindowDimensions } from 'react-native';
import { Play, MusicNote as Music, Users, Clock } from '../src/icons';
import { api } from '../src/api';
import { Text } from '../src/Text';
import { useAppearance } from '../src/appearance';
import { useResource, Status } from '../src/CatalogPieces';
import { Action, Copy, Page } from '../src/controls';
import { WaveLoading } from '../src/WaveLoading';

export default function Stats() {
  const theme = useAppearance();
  const { width } = useWindowDimensions();
  const result = useResource(api.stats);
  const stats = result.data;
  const duration = stats ? formatDuration(stats.duration_seconds) : '';
  const columns = width >= 1000 && theme.scale <= 1.15 ? 4 : width >= 350 && theme.scale <= 1.15 ? 2 : 1;
  return <Page title="stats">
    <Copy>music shared on plyr.fm.</Copy>
    {!stats && !result.error && <WaveLoading label="loading stats" />}
    <Status error={result.error} retry={result.retry} />
    {stats && <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {([
          { label: 'plays on Next', value: stats.plays.toLocaleString(), icon: Play },
          { label: 'tracks', value: stats.tracks.toLocaleString(), icon: Music },
          { label: 'artists', value: stats.artists.toLocaleString(), icon: Users },
          { label: 'of audio', value: duration, icon: Clock },
        ] as const).map(({ label, value, icon: Icon }) => <View key={label} accessible accessibilityLabel={`${value} ${label}`}
          style={{ flexBasis: columns === 4 ? '22%' : columns === 2 ? '45%' : '100%', flexGrow: 1, minWidth: 0, padding: 20, gap: 12, borderRadius: 16, backgroundColor: theme.surface }}>
          <Icon size={22} color={theme.accent} />
          <Text style={{ color: theme.text, fontSize: 26 * theme.scale, lineHeight: 32 * theme.scale, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
          <Text style={{ color: theme.muted, fontSize: 15 * theme.scale }}>{label}</Text>
        </View>)}
      </View>
      <View style={{ gap: 8, marginTop: 12 }}>
        <Text accessibilityRole="header" aria-level={2} style={{ color: theme.text, fontSize: 18 * theme.scale, fontWeight: '700' }}>what counts</Text>
        <Copy>tracks, artists and audio cover the public catalog available on Next. private, unlisted and removed tracks aren’t included. artists have at least one included track.</Copy>
        <Copy>plays are qualifying listens counted by Next for those tracks. production’s historical plays aren’t included yet. audio is the catalog’s total running time, not time spent listening.</Copy>
        <Copy>Updated {new Date(stats.updated_at_ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Totals can be up to a minute old.</Copy>
      </View>
      <View style={{ alignSelf: 'flex-start' }}><Action label="refresh stats" onPress={result.retry} /></View>
    </>}
  </Page>;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${Math.floor(seconds / 60) % 60}m`;
  return `${Math.floor(seconds / 60)}m`;
}
