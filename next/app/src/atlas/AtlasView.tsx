import { View } from 'react-native';
import type { Track } from '../api';
import { useAppearance } from '../appearance';
import { Text } from '../Text';

export function AtlasView(_props: { preview?: boolean; onPlay: (track: Track) => void; onSummary?: (summary: string) => void }) {
  const theme = useAppearance();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <Text style={{ color: theme.muted, fontSize: 15 * theme.scale, textAlign: 'center' }}>the atlas is on next.plyr.fm in a browser for now.</Text>
  </View>;
}
