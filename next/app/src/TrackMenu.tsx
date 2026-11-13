import type { ReactNode } from 'react';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Pencil from 'lucide-react-native/icons/pencil';
import ListPlus from 'lucide-react-native/icons/list-plus';
import LogIn from 'lucide-react-native/icons/log-in';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import type { Track } from './api';
import { isPrivateTrack } from './publishing/private-track';
import { useAuth } from './auth';
import { ActionRow } from './ActionRow';
import { TrackPlaylistPicker } from './AccountCatalog';
import { ShareLink } from './ShareLink';
import { TrackLikes } from './TrackLikes';
import { usePlayback } from './playback';
import { Sheet } from './Sheet';
import { DownloadAction } from './downloads/DownloadAction';
import { AccessSheet } from './access/AccessSheet';
import { trackSpace } from './access/policy';
import Lock from 'lucide-react-native/icons/lock';

export function TrackMenu({ track, close, actions, returnTo }: { track: Track; close: () => void; actions?: ReactNode; returnTo?: string }) {
  const { did } = useAuth();
  const player = usePlayback();
  const router = useRouter();
  const [playlists, setPlaylists] = useState(false);
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
  if (access) return <AccessSheet track={track} close={close} />;
  if (isPrivateTrack(track)) return <Sheet title="private track" close={close}>
    <ActionRow icon={ListPlus} label="add to private queue" onPress={() => { player.enqueue(track); close(); }} />
  </Sheet>;
  return <Sheet title={playlists && did ? 'add to playlist' : 'track options'} close={close} visible={!destination} onDismiss={finishNavigation}>

    <View style={{ gap: 0 }}>
      {playlists && did ? <>
        <ActionRow icon={ArrowLeft} label="back" onPress={() => setPlaylists(false)} />
        <TrackPlaylistPicker key={did} track={track} />
      </> : <>
        <TrackLikes track={track} menu returnTo={returnTo} onNavigate={close} />
        <ActionRow icon={ListPlus} label="add to queue" onPress={() => { player.enqueue(track); close(); }} />
        {did === track.artist.did && <ActionRow icon={Pencil} label="edit track"
          href={Platform.OS === 'ios' ? undefined : `/edit-track/${track.id}`}
          onPress={Platform.OS === 'ios' ? () => setDestination(`/edit-track/${track.id}`) : close} />}
        {did === track.artist.did && trackSpace(track) && <ActionRow icon={Lock} label="who can listen" onPress={() => setAccess(true)} />}
        <DownloadAction key={track.record.uri} track={track} reconnect={reconnect} />
        <ShareLink menu path={`/track/${encodeURIComponent(track.id)}`} />
        {did ? <ActionRow icon={ListPlus} label="add to playlist" onPress={() => setPlaylists(true)} /> :
          <ActionRow icon={LogIn} label="sign in to save" href={{ pathname: '/login', params: { return_to: `/track/${track.id}` } }} onPress={close} />}
        {actions}
      </>}
    </View>
  </Sheet>;
}
