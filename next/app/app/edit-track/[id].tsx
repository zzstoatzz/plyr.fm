import { useLocalSearchParams } from 'expo-router';
import { TrackEditor } from '../../src/publishing/TrackEditor';

export default function EditTrack() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TrackEditor id={id} />;
}
