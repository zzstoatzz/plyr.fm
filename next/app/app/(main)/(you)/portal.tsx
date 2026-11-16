import Login from '../../../src/Login';
import { Portal } from '../../../src/Portal';
import { useAuth } from '../../../src/auth';
import { Page } from '../../../src/controls';
import { WaveLoading } from '../../../src/WaveLoading';

export default function AccountRoute() {
  const { did, ready } = useAuth();
  if (!ready) return <Page title="your music"><WaveLoading label="loading your account" /></Page>;
  return did ? <Portal /> : <Login />;
}
