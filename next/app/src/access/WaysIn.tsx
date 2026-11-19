import { Link } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { Track } from '@plyr/next-core/api';
import { waysIn, type WayIn } from '@plyr/next-core/access/ways-in';
import type { Policy } from '@plyr/next-core/access/policy';
import type { Offer } from '@plyr/next-core/selling';
import { useAppearance } from '../appearance';
import { useAuth } from '../auth';
import { artistName } from '../CatalogPieces';
import { ArrowSquareOut, Heart, Lock, SignIn, Tag, Users, type Icon } from '../icons';
import { Text } from '../Text';
import { toast } from '../toast';
import { useSpacePolicies } from './use-track-access';
import { trackSpace } from './policy';

const ICONS: Record<WayIn['kind'], Icon> = { buy: Tag, support: Heart, 'sign-in': SignIn, members: Users, supporter: Heart, purchase: Tag };

/** how a gated track's listener gets in; `admitted` when its rules already let them listen */
export function useWaysIn(track: Track, offer?: Offer, support?: string) {
  const auth = useAuth();
  const space = trackSpace(track);
  const read = useSpacePolicies(track.artist.did, space);
  const rules = read.policies?.length ? read.policies : read.fallback ? [{ rule: read.fallback }] : [];
  return { space, policies: read.policies, ...waysIn({ artist: artistName(track), rules, offer, support, viewer: auth.did ?? undefined }) };
}

/** a closed track, seen by someone the rules don't let in: who can listen and how to get in */
export function WaysIn({ track, view }: { track: Track; view: ReturnType<typeof useWaysIn> & { policies?: Policy[] } }) {
  const theme = useAppearance();
  const { space, ways, note, policies, admitted } = view;
  if (!space || admitted) return null;
  const artist = artistName(track);
  const size = 15 * theme.scale;
  const small = { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 18 * theme.scale };
  const go = { color: theme.accent, fontFamily: theme.fontFamily, fontSize: size, fontWeight: '700' } as const;
  return <View accessibilityLabel="how to listen" style={styles.ways}>
    <View style={styles.lead}>
      <Lock size={16 * theme.scale} color={theme.muted} />
      <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: size }}>{artist} shares this one with some people</Text>
    </View>
    {ways.length ? <View style={[styles.list, { borderColor: theme.line, backgroundColor: theme.raised }]}>
      {ways.map((way, index) => {
        const Glyph = ICONS[way.kind];
        return <View key={way.key} style={[styles.row, index ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line } : null]}>
          <Glyph size={18 * theme.scale} color={theme.muted} />
          <View style={styles.copy}>
            <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: size }}>{way.title}</Text>
            <Text style={small}>{way.detail}</Text>
          </View>
          {way.url ? <Pressable accessibilityRole="link" accessibilityLabel={`${way.action} ${way.detail}, opens your browser`} hitSlop={8} style={styles.go}
            onPress={() => void Linking.openURL(way.url!).catch(() => toast.error('couldn’t open that link'))}>
            <Text style={go}>{way.action}</Text><ArrowSquareOut size={14 * theme.scale} color={theme.accent} />
          </Pressable>
            : way.action === 'sign in' ? <Link href={{ pathname: '/login', params: { return_to: `/track/${track.id}` } }} asChild>
              <Pressable accessibilityRole="link" hitSlop={8} style={styles.go}><Text style={go}>sign in</Text></Pressable>
            </Link> : null}
        </View>;
      })}
    </View> : policies ? <Text style={small}>only {artist} can listen right now.</Text> : null}
    {note ? <Text style={small}>{note}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  ways: { width: '100%', maxWidth: 420, gap: 10 },
  lead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  copy: { flex: 1, minWidth: 0 },
  go: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 4 },
});
