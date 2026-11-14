import { useState } from 'react';
import { View } from 'react-native';
import { useAppearance } from '../appearance';
import { pageFrame } from '../controls';
import { usePlayback } from '../playback';
import { Text } from '../Text';
import { AtlasView } from './AtlasView';

export function AtlasRoute() {
  const theme = useAppearance();
  const { play } = usePlayback();
  const [summary, setSummary] = useState<string>();
  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    <View style={{ ...pageFrame, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 16, paddingBottom: 8 }}>
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>the catalog, mapped by sound. zoom in, click a track to play it.</Text>
      {summary ? <Text style={{ color: theme.faint, fontSize: 12.5 * theme.scale, fontFamily: 'monospace' }}>{summary}</Text> : null}
    </View>
    <AtlasView onPlay={track => play(track)} onSummary={setSummary} />
  </View>;
}
