import { useRef } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { waysIn } from '@plyr/next-core/access/ways-in';
import { addWay, previewRules, WAY_KINDS, wayProblem, type AccessDraft, type WayDraft, type WayKind } from '@plyr/next-core/publishing/upload-access';
import { useAppearance } from '../appearance';
import { Action, inputFontSize } from '../controls';
import { Globe, Heart, Info, Lock, MusicNote, Plus, Tag, UserCircle, Users, X, type Icon } from '../icons';
import { Text } from '../Text';
import { WaysInList } from '../access/WaysIn';
import type { MediaFile } from '../pds';
import { usePreviewUri } from './preview-uri';
import { useRadioGroup } from '../behaviors/use-radio-group';
import { FieldError } from './UploadPieces';

const WAYS: Record<WayKind, { icon: Icon; title: string; detail: string; add: string }> = {
  supporter: { icon: Heart, title: 'your supporters', detail: 'anyone with a verified payment to you, any amount', add: 'your supporters' },
  purchase: { icon: Tag, title: 'buy it for', detail: 'a one-time purchase, kept on the buyer’s account', add: 'a price to buy it' },
  signedIn: { icon: UserCircle, title: 'anyone signed in', detail: 'any account, on plyr.fm or another app', add: 'anyone signed in' },
  members: { icon: Users, title: 'people you pick', detail: 'they sign in to listen. the list is public.', add: 'people you pick' },
};

/** who can listen to a new track: open, or closed with any number of ways in. closed with none is only you. */
export function AccessSection({ access, onChange, artist, title, artwork, disabled, checked, needsSignIn }: {
  access: AccessDraft; onChange: (access: AccessDraft) => void; artist: string; title: string; artwork: MediaFile | null;
  disabled?: boolean; /** show each way's problem, after a submit tried */ checked?: boolean; /** sign in again before this kind of track can publish */ needsSignIn?: boolean;
}) {
  const theme = useAppearance();
  const cover = usePreviewUri(artwork);
  const fields = useRef<Partial<Record<WayKind, TextInputInstance | null>>>({});
  const radio = useRadioGroup({ label: 'who can listen', value: access.closed, disabled, onChange: closed => onChange({ closed, ways: closed ? access.ways : [] }) });
  const missing = WAY_KINDS.filter(kind => !access.ways.some(way => way.kind === kind));
  const preview = waysIn({ artist, rules: previewRules(access) });
  const type = (size: number, color = theme.text, weight: '400' | '600' | '700' = '400') => ({ color, fontFamily: theme.fontFamily, fontSize: size * theme.scale, fontWeight: weight, lineHeight: size * 1.4 * theme.scale });
  const update = (index: number, way: WayDraft) => onChange({ ...access, ways: access.ways.map((item, at) => at === index ? way : item) });
  function add(kind: WayKind) {
    onChange({ ...access, ways: addWay(access.ways, kind) });
    if (kind === 'purchase' || kind === 'members') setTimeout(() => fields.current[kind]?.focus(), 0);
  }
  const input = (bad: boolean) => [styles.input, { color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale), borderColor: bad ? theme.danger : theme.border, backgroundColor: theme.background }];

  const tile = (closed: boolean) => {
    const on = access.closed === closed;
    const Glyph = closed ? Lock : Globe;
    return <Pressable key={String(closed)} {...radio.option(closed)}
      style={({ pressed }) => [styles.tile, { borderColor: on ? theme.accent : theme.line, backgroundColor: on ? theme.accent + '14' : pressed ? theme.hover : theme.background }]}>
      <View style={[styles.glyph, { backgroundColor: on ? theme.accent + '29' : theme.raised }]}><Glyph size={18} color={on ? theme.accent : theme.muted} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type(15, theme.text, '700')}>{closed ? 'closed' : 'open'}</Text>
        <Text style={type(13, theme.muted)}>{closed ? 'only through a way in' : 'anyone, anywhere'}</Text>
      </View>
    </Pressable>;
  };

  return <View style={{ gap: 12 }}>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={type(18, theme.text, '700')}>who can listen</Text>
      <Text style={type(14, theme.muted)}>open to everyone, or closed with any number of ways in. passing any one of them lets someone listen.</Text>
    </View>
    <View style={[styles.card, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
      <View {...radio.group} style={styles.tiles}>{[false, true].map(tile)}</View>
      {access.closed ? <>
        <View style={styles.label}>
          <Text style={type(12, theme.faint, '700')}>WAYS IN</Text>
          {!!access.ways.length && <Text style={type(12, theme.faint)}>{access.ways.length === 1 ? '1 of them' : `${access.ways.length} of them`}</Text>}
        </View>
        {access.ways.map((way, index) => {
          const info = WAYS[way.kind];
          const problem = checked ? wayProblem(way) : undefined;
          return <View key={way.kind} style={[styles.way, { borderColor: theme.line, backgroundColor: theme.background }]}>
            <View style={[styles.glyph, { backgroundColor: theme.accent + '29' }]}><info.icon size={18} color={theme.accent} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              {way.kind === 'purchase' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={type(15, theme.text, '700')}>{info.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={type(15, theme.muted)}>$</Text>
                  <TextInput ref={node => { fields.current.purchase = node; }} accessibilityLabel="price to buy it, in US dollars" value={way.price} placeholder="5"
                    placeholderTextColor={theme.faint} keyboardType="decimal-pad" editable={!disabled} onChangeText={price => update(index, { kind: 'purchase', price })}
                    style={[input(!!problem), { width: 84 }]} />
                  <Text style={type(12, theme.faint, '700')}>USD</Text>
                </View>
              </View> : <Text style={type(15, theme.text, '700')}>{info.title}</Text>}
              {way.kind === 'members' && <TextInput ref={node => { fields.current.members = node; }} accessibilityLabel="people you pick" value={way.people}
                placeholder="handles, like name.bsky.social" placeholderTextColor={theme.faint} autoCapitalize="none" autoCorrect={false} editable={!disabled}
                onChangeText={people => update(index, { kind: 'members', people })} style={input(!!problem)} />}
              <Text style={type(13, theme.muted)}>{info.detail}</Text>
              {way.kind === 'purchase' && <View style={[styles.soon, { backgroundColor: theme.raised }]}><Text style={type(12, theme.muted, '600')}>checkout coming soon</Text></View>}
              {problem && <FieldError>{problem}</FieldError>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`remove ${info.add}`} disabled={disabled} hitSlop={6} onPress={() => onChange({ ...access, ways: access.ways.filter((_, at) => at !== index) })}
              style={({ pressed }) => [styles.remove, { backgroundColor: pressed ? theme.hover : 'transparent' }]}>
              <X size={18} color={theme.muted} />
            </Pressable>
          </View>;
        })}
        {!!missing.length && <View style={styles.adds}>
          {missing.map(kind => <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`add ${WAYS[kind].add}`} disabled={disabled} onPress={() => add(kind)}
            style={({ pressed }) => [styles.add, { borderColor: theme.border, backgroundColor: pressed ? theme.hover : 'transparent' }]}>
            <Plus size={15} color={theme.text} /><Text style={type(14, theme.text, '600')}>{WAYS[kind].add}</Text>
          </Pressable>)}
        </View>}
        <Text style={type(13, theme.muted)}>{access.ways.length ? 'people who can listen can still record what they hear.' : 'no ways in means only you can play it. it stays in your library and nobody else can find it.'}</Text>
      </> : <Text style={type(13, theme.muted)}>on your profile, in feeds and search, free to play.</Text>}
      {needsSignIn && <View style={{ gap: 8 }}>
        <FieldError>sign in again to allow this. what you typed stays here.</FieldError>
        <Action label="Sign in again" href={{ pathname: '/login', params: { return_to: '/upload' } }} />
      </View>}
    </View>
    {access.closed && <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Info size={15} color={theme.faint} /><Text style={type(13, theme.faint, '600')}>what a listener without access sees</Text></View>
      {access.ways.length ? <View style={[styles.card, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.art, { backgroundColor: theme.raised }]}>{cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} /> : <MusicNote size={20} color={theme.faint} />}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={type(15, theme.text, '700')}>{title.trim() || 'your track'}</Text>
            <Text numberOfLines={1} style={type(13, theme.muted)}>{artist}</Text>
          </View>
        </View>
        <WaysInList artist={artist} ways={preview.ways} empty preview />
      </View> : <View style={[styles.card, styles.hidden, { borderColor: theme.line }]}>
        <Lock size={20} color={theme.faint} /><Text style={[type(14, theme.muted), { flex: 1 }]}>nobody else can find this track. it’s only in your library.</Text>
      </View>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 12, borderWidth: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: 150, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: 12, borderWidth: 1.5 },
  glyph: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  way: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  input: { minHeight: 44, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  soon: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  remove: { width: 44, height: 44, marginTop: -6, marginRight: -6, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  adds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed' },
  art: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  hidden: { flexDirection: 'row', alignItems: 'center', borderStyle: 'dashed' },
});
