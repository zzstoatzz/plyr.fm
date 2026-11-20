import { Stack } from 'expo-router';
import { useAppearance } from '../../../src/appearance';
import { useIslandHidesStatusBar } from '../../../src/publishing/UploadIsland';

export const unstable_settings = {
  anchor: 'index',
  search: { anchor: 'search' },
  library: { anchor: 'library' },
  publish: { anchor: 'upload' },
  you: { anchor: 'portal' }
};

export default function TabStack() {
  const theme = useAppearance();
  // The deepest screen decides status bar visibility, so the tab stacks step it aside for the upload island too.
  const islandOut = useIslandHidesStatusBar();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background }, statusBarHidden: islandOut, statusBarAnimation: 'fade' }} />;
}
