import { Redirect, router, type Href } from 'expo-router';
import { useContext, useEffect, useRef } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { usePlayerPanel } from '../src/player-panel';
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
  const panel = usePlayerPanel();
  const { width } = useWindowDimensions();
  const desktop = width >= 800 && Platform.OS === 'web';
  useEffect(() => {
    if (!desktop || !player.current || leaving.current) return;
    leaving.current = true; panel.setExpanded(true);
    if (router.canGoBack()) router.back(); else router.replace('/');
  }, [desktop, player.current?.id, panel.setExpanded]);
  if (Platform.OS !== 'web' || !player.current) return <Redirect href="/" />;
  const leave = (target?: Href) => {
    if (leaving.current) return;
    leaving.current = true;
    if (target !== undefined && !(typeof target === 'string' && samePath(target, origin))) router.replace(target);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  if (desktop) return null;
  return <NowPlaying track={player.current} close={() => leave()} navigate={target => leave(target)} />;
}
