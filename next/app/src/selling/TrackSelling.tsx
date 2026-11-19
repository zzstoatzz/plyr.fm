import { Linking, StyleSheet, View } from 'react-native';
import type { Track } from '@plyr/next-core/api';
import { isOpen } from '@plyr/next-core/access/policy';
import { offerLabel } from '@plyr/next-core/selling';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { useAppearance } from '../appearance';
import { Pill } from '../HeroPieces';
import { ArrowSquareOut } from '../icons';
import { toast } from '../toast';
import { WaysIn } from '../access/WaysIn';
import { useTrackSelling } from './use-selling';

/** a track page's way to buy it, or, when it's closed to this listener, every way in */
export function TrackSelling({ track, viewer }: { track: Track; viewer?: string | null }) {
  const theme = useAppearance();
  const { offer, support } = useTrackSelling(track);
  const closed = !isPrivateTrack(track) && !isOpen(track) && !!track.access.space_uri && viewer !== track.artist.did;
  if (closed) return <WaysIn track={track} offer={offer} support={support} />;
  if (!offer) return null;
  return <View style={styles.buy}>
    <Pill outline role="link" icon={<ArrowSquareOut size={18 * theme.scale} color={theme.accent} />} label={`buy · ${offerLabel(offer)}`}
      accessibilityLabel={`Buy ${track.metadata.title}, ${offerLabel(offer)}, opens your browser`}
      onPress={() => void Linking.openURL(offer.url).catch(() => toast.error('couldn’t open that link'))} />
  </View>;
}

const styles = StyleSheet.create({ buy: { flexDirection: 'row', justifyContent: 'center', maxWidth: '100%' } });
