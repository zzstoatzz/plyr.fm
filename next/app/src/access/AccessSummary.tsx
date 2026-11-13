import type { TextStyle } from 'react-native';
import type { Track } from '../api';
import { Text } from '../Text';
import { describePolicy, describeRule } from './policy';
import { useTrackAccess } from './use-track-access';

/** one line saying who can listen to a closed track; nothing for open ones */
export function AccessSummary({ track, style }: { track: Track; style: TextStyle }) {
  const access = useTrackAccess(track);
  if (access.state === 'open') return null;
  if (access.state === 'owner-only') return <Text style={style}>only you · listening stays on this device</Text>;
  const { policies, fallback, error, space } = access;
  const ways = policies?.length ? policies.map(describePolicy) : fallback ? [describeRule(fallback)] : [];
  const line = !space || error ? 'closed' : !policies ? 'closed · checking who can listen' : ways.length ? `open to ${ways.join(' · ')}` : 'closed · only the artist can listen';
  return <Text style={style}>{line}</Text>;
}
