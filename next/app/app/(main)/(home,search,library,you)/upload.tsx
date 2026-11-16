import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback } from 'react';
import { useAuth } from '../../../src/auth';
import { Page } from '../../../src/controls';
import { UploadSignIn } from '../../../src/publishing/UploadSignIn';
import { WaveLoading } from '../../../src/WaveLoading';

export default function UploadLink() {
  const { ready, did } = useAuth();
  const { visibility } = useLocalSearchParams<{ visibility?: string }>();
  const navigation = useNavigation();
  useFocusEffect(useCallback(() => {
    if (!did) return;
    if ((navigation.getState()?.index ?? 0) > 0) router.dismiss();
    router.navigate({ pathname: '/(main)/(publish)/upload', params: { visibility } });
  }, [did, navigation, visibility]));
  return <Page title="upload">
    {did || !ready ? <WaveLoading label="opening upload" /> : <UploadSignIn onlyYou={visibility === 'only-you'} />}
  </Page>;
}
