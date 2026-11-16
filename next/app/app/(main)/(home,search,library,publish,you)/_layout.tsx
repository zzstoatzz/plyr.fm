import { Stack } from 'expo-router';
import { useAppearance } from '../../../src/appearance';

export const unstable_settings = {
  anchor: 'index',
  search: { anchor: 'search' },
  library: { anchor: 'library' },
  publish: { anchor: 'upload' },
  you: { anchor: 'portal' }
};

export default function TabStack() {
  const theme = useAppearance();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />;
}
