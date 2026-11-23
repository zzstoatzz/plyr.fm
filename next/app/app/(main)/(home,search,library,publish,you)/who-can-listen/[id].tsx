import { useLocalSearchParams } from 'expo-router';
import { TrackAccessScreen } from '../../../../src/access/TrackAccessScreen';

export default function WhoCanListen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TrackAccessScreen id={id} />;
}
