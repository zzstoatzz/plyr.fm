import { Alert } from 'react-native';

/** The one confirm for deleting a track, wherever delete is offered. */
export function confirmTrackDelete(title: string, remove: () => void) {
  Alert.alert(`delete "${title}"?`, 'it comes off your profile and plyr.fm, along with its likes and plays. keep your original file: this cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: remove }
  ]);
}
