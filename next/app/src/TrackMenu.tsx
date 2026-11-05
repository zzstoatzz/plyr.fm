import type { ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import Pencil from 'lucide-react-native/icons/pencil';
import ListPlus from 'lucide-react-native/icons/list-plus';
import LogIn from 'lucide-react-native/icons/log-in';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import type { Track } from './api';
import { useAuth } from './auth';
import { ActionRow } from './ActionRow';
import { TrackPlaylistPicker } from './AccountCatalog';
import { ShareLink } from './ShareLink';
import { TrackLikes } from './TrackLikes';
import { usePlayback } from './playback';
import { Sheet } from './Sheet';

export function TrackMenu({ track, close, actions, returnTo }: { track: Track; close: () => void; actions?: ReactNode; returnTo?: string }) {
  const { did } = useAuth();
  const player = usePlayback();
  const [playlists, setPlaylists] = useState(false);
  return <Sheet title={playlists && did ? 'add to playlist' : 'track options'} close={close}>
    <View style={{ gap: 0 }}>
      {playlists && did ? <>
        <ActionRow icon={ArrowLeft} label="back" onPress={() => setPlaylists(false)} />
        <TrackPlaylistPicker key={did} track={track} />
      </> : <>
        <TrackLikes track={track} menu returnTo={returnTo} onNavigate={close} />
        <ActionRow icon={ListPlus} label="add to queue" onPress={() => { player.enqueue(track); close(); }} />
        {did === track.artist.did && <ActionRow icon={Pencil} label="edit track" href={`/edit-track/${track.id}`} onPress={close} />}
        <ShareLink menu path={`/track/${encodeURIComponent(track.id)}`} />
        {did ? <ActionRow icon={ListPlus} label="add to playlist" onPress={() => setPlaylists(true)} /> :
          <ActionRow icon={LogIn} label="sign in to save" href={{ pathname: '/login', params: { return_to: `/track/${track.id}` } }} onPress={close} />}
        {actions}
      </>}
    </View>
  </Sheet>;
}
