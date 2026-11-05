import { Redirect, router } from 'expo-router';
import { useContext } from 'react';
import { Platform } from 'react-native';
import { NowPlaying } from '../src/NowPlaying';
import { usePlayback } from '../src/playback';
import { NowPlayingOriginContext } from '../src/now-playing-origin';

function samePath(target: string, origin: string) {
  try { return decodeURIComponent(target) === decodeURIComponent(origin); }
  catch { return target === origin; }
}

export default function NowPlayingRoute() {
  const player = usePlayback();
  const origin = useContext(NowPlayingOriginContext);
  if (Platform.OS !== 'web' || !player.current) return <Redirect href="/" />;
  return <NowPlaying track={player.current}
    close={() => router.canGoBack() ? router.back() : router.replace('/')}
    navigate={target => {
      if (typeof target === 'string' && samePath(target, origin)) router.back();
      else router.replace(target);
    }} />;
}
