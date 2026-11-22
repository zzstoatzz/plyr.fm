import { useLocalSearchParams } from 'expo-router';
import { AccountPortal } from '../../../src/Portal';

/** SCRATCH, not for merge: renders the you page for any did with public data, to check layout on a signed-out simulator. */
export default function PortalLab() {
  const { did, handle } = useLocalSearchParams<{ did: string; handle?: string }>();
  return <AccountPortal key={did} did={did} handle={handle ?? null} />;
}
