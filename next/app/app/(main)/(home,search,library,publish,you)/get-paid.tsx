import { View } from 'react-native';
import Login from '../../../src/Login';
import { useAuth } from '../../../src/auth';
import { Page } from '../../../src/controls';
import { SellCard } from '../../../src/selling/SellCard';
import { WaveLoading } from '../../../src/WaveLoading';

export default function GetPaidRoute() {
  const { did, ready } = useAuth();
  if (!ready) return <Page title="get paid"><WaveLoading label="loading your account" /></Page>;
  if (!did) return <Login />;
  return <Page title="get paid"><View><SellCard key={did} did={did} alwaysOpen /></View></Page>;
}
