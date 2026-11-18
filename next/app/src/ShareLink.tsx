import { Share, View } from 'react-native';
import { ShareNetwork as ShareIcon } from './icons';
import { SITE_URL } from './config';
import { Button } from './CatalogPieces';
import { PlayerControl } from './PlayerControl';
import { ActionRow } from './ActionRow';
import { toast } from './toast';

export async function shareLink(path: string) {
  try {
    await Share.share({ message: SITE_URL + path });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) toast.error('failed to share link');
  }
}

export function ShareLink({ path, compact = false, menu = false }: { path: string; compact?: boolean; menu?: boolean }) {
  const share = () => shareLink(path);
  return <View style={{ gap: 8 }}>
    {menu ? <ActionRow icon={ShareIcon} label="share" onPress={() => void share()} /> : compact ? <PlayerControl icon={ShareIcon} label="Share" onPress={() => void share()} /> : <Button label="Share" onPress={() => void share()} />}
  </View>;
}

