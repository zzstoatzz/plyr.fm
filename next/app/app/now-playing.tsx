import { Redirect, router, type Href } from 'expo-router';
import { useContext, useRef } from 'react';
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
  const leaving = useRef(false);
  if (Platform.OS !== 'web' || !player.current) return <Redirect href="/" />;
  const leave = (target?: Href) => {
    if (leaving.current) return;
    leaving.current = true;
    if (target !== undefined && !(typeof target === 'string' && samePath(target, origin))) router.replace(target);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return <NowPlaying track={player.current} close={() => leave()} navigate={target => leave(target)} />;
}
