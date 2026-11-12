import { Redirect, router, type Href } from 'expo-router';
import { useContext, useEffect, useRef } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { NowPlaying } from '../src/NowPlaying';
import { usePlayback } from '../src/playback';
import { NowPlayingOriginContext } from '../src/now-playing-origin';
import { playerSheet } from '../src/player-sheet';

function samePath(target: string, origin: string) {
  try { return decodeURIComponent(target) === decodeURIComponent(origin); }
  catch { return target === origin; }
}

export default function NowPlayingRoute() {
  const player = usePlayback();
  const origin = useContext(NowPlayingOriginContext);
  const leaving = useRef(false);
  const hosted = Platform.OS === 'web' && useWindowDimensions().width < 600;
  const playable = !!player.current;
  useEffect(() => {
    if (!hosted || !playable) return;
    playerSheet.show(true);
    return () => { if (!playerSheet.leaving) playerSheet.hide(); };
  }, [hosted, playable]);
  if (Platform.OS !== 'web' || !player.current) return <Redirect href="/" />;
  if (hosted) return null;
  const leave = (target?: Href) => {
    if (leaving.current) return;
    leaving.current = true;
    if (target !== undefined && !(typeof target === 'string' && samePath(target, origin))) router.replace(target);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return <NowPlaying track={player.current} close={() => leave()} navigate={target => leave(target)} />;
}
