import type { ReactNode } from 'react';
import { PencilSimple as Pencil, ListPlus, Playlist as PlaylistIcon, SignIn as LogIn, ArrowLeft, Lock, SkipForward, UserCircle } from './icons';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { Track } from '@plyr/next-core/api';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { useAuth } from './auth';
import { ActionRow } from './ActionRow';
import { TrackPlaylistPicker } from './collections/TrackPlaylistPicker';
import { ShareLink } from './ShareLink';
import { TrackLikes } from './TrackLikes';
import { usePlayback } from './playback';
import { Sheet, type Anchor, type Lift } from './Sheet';
import { DownloadAction } from './downloads/DownloadAction';
import { AccessSheet } from './access/AccessSheet';

export function TrackMenu({ track, close, actions, returnTo, anchor, lift }: { track: Track; close: () => void; actions?: ReactNode; returnTo?: string; anchor?: Anchor; lift?: Lift }) {
  const { did } = useAuth();
  const player = usePlayback();
  const router = useRouter();
  const [playlists, setPlaylists] = useState(false);
  const [download, setDownload] = useState(false);
  const [access, setAccess] = useState(false);
  const [destination, setDestination] = useState<Href>();
  function finishNavigation() {
    if (!destination) return;
    close();
    router.push(destination);
  }
  function reconnect() {
    const login: Href = { pathname: '/login', params: { return_to: `/track/${track.id}` } };
    if (Platform.OS === 'ios') setDestination(login);
    else { close(); router.push(login); }
  }
  if (access) return <AccessSheet subject={{ noun: 'track', tracks: [track], skey: track.record.rkey, returnTo: `/track/${track.id}` }} close={close} />;
  function go(href: Href) {
    if (Platform.OS === 'ios') setDestination(href);
    else { close(); router.push(href); }
  }
  if (isPrivateTrack(track)) return <Sheet title="private track" close={close} anchor={anchor} lift={lift}>
    <ActionRow icon={ListPlus} label="add to private queue" onPress={() => { player.enqueue(track); close(); }} />
  </Sheet>;
  return <Sheet title={playlists && did ? 'add to playlist' : download ? 'download' : 'track options'} close={close} visible={!destination} onDismiss={finishNavigation} anchor={anchor} lift={lift}>

    <View style={{ gap: 0 }}>
      {playlists && did ? <>
        <ActionRow icon={ArrowLeft} label="back" onPress={() => setPlaylists(false)} />
        <TrackPlaylistPicker key={did} track={track} done={close} />
      </> : <>
        {!download && <>
        <ActionRow icon={SkipForward} label="play next" onPress={() => { player.playNext(track); close(); }} />
        <ActionRow icon={ListPlus} label="add to queue" onPress={() => { player.enqueue(track); close(); }} />
        {did ? <ActionRow icon={PlaylistIcon} label="add to playlist" onPress={() => setPlaylists(true)} /> :
          <ActionRow icon={LogIn} label="sign in to save" href={{ pathname: '/login', params: { return_to: `/track/${track.id}` } }} onPress={close} />}
        </>}
        <DownloadAction key={track.record.uri} track={track} reconnect={reconnect} expanded={download} onExpand={setDownload} done={close} />
        {!download && <>
        <TrackLikes track={track} menu returnTo={returnTo} onNavigate={close} />
        {did === track.artist.did && <ActionRow icon={Pencil} label="edit track"
          href={Platform.OS === 'ios' ? undefined : `/edit-track/${track.id}`}
          onPress={Platform.OS === 'ios' ? () => setDestination(`/edit-track/${track.id}`) : close} />}
        {did === track.artist.did && <ActionRow icon={Lock} label="who can listen" onPress={() => setAccess(true)} />}
        <ShareLink menu path={`/track/${encodeURIComponent(track.id)}`} />
        <ActionRow icon={UserCircle} label="go to artist" onPress={() => go({ pathname: '/u/[handle]', params: { handle: track.artist.profile.handle || track.artist.did } })} />
        {actions}
        </>}
      </>}
    </View>
  </Sheet>;
}
