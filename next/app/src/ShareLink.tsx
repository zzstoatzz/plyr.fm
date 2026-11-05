import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import ShareIcon from 'lucide-react-native/icons/share-2';
import { SITE_URL } from './config';
import { Button, Detail } from './CatalogPieces';
import { PlayerControl } from './PlayerControl';
import { ActionRow } from './ActionRow';

export function ShareLink({ path, compact = false, menu = false }: { path: string; compact?: boolean; menu?: boolean }) {
  const [message, setMessage] = useState<string>();
  async function share() {
    try {
      const url = SITE_URL + path;
      if (Platform.OS === 'web' && typeof navigator.share !== 'function') {
        await navigator.clipboard.writeText(url);
        setMessage('Link copied.');
      } else if (Platform.OS === 'web') {
        await navigator.share({ url });
      } else {
        await Share.share({ message: url });
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage('Could not share this link.');
    }
  }
  return <View style={{ gap: 8 }}>
    {menu ? <ActionRow icon={ShareIcon} label="share" onPress={() => void share()} /> : compact ? <PlayerControl icon={ShareIcon} label="Share" onPress={() => void share()} /> : <Button label="Share" onPress={() => void share()} />}
    {message && <Detail>{message}</Detail>}
  </View>;
}

