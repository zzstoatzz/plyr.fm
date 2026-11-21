import { useEffect, useId, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { SearchHit } from '@plyr/next-core/api';
import type { FeaturedArtist } from '@plyr/next-core/pds';
import { memberDid } from '@plyr/next-core/access/policy-read';
import { api } from '../api-client';
import { useAppearance } from '../appearance';
import { Copy, inputFontSize } from '../controls';
import { X } from '../icons';
import { Text } from '../Text';
import { Cover } from '../CatalogPieces';
import { FieldError } from './UploadPieces';

const MAX = 10;

/** featured artists: pick from plyr.fm artists as you type, or enter any handle */
export function FeatureField({ value, onChange, disabled, owner }: { value: FeaturedArtist[]; onChange: (value: FeaturedArtist[]) => void; disabled: boolean; owner?: string }) {
  const theme = useAppearance();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [problem, setProblem] = useState('');
  const [resolving, setResolving] = useState(false);
  const full = value.length >= MAX;
  const options = focused ? hits.filter(hit => hit.owner.did !== owner && !value.some(artist => artist.did === hit.owner.did)) : [];

  useEffect(() => {
    const q = draft.trim().replace(/^@/, '');
    if (q.length < 2) { setHits([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.search(q, { types: 'artist', limit: 6, signal: controller.signal }).then(page => setHits(page.data), () => {});
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft]);

  function add(artist: FeaturedArtist) {
    setProblem('');
    if (artist.did === owner) { setProblem('that’s you. you’re already the artist.'); return; }
    if (!value.some(item => item.did === artist.did) && value.length < MAX) onChange([...value, artist]);
    setDraft(''); setHits([]);
  }

  async function commit(typed = draft) {
    const text = typed.trim();
    if (!text || resolving) return;
    setResolving(true); setProblem('');
    try {
      const did = await memberDid(text);
      const handle = text.replace(/^@/, '');
      add({ did, ...(handle.startsWith('did:') ? {} : { handle }) });
    } catch (failure) {
      // keep what they typed so they can fix it
      setProblem(failure instanceof Error ? failure.message : 'could not find that account.');
    } finally { setResolving(false); }
  }

  const label = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale };
  return <View style={{ gap: 6, minWidth: 0 }}>
    <Text nativeID={id} style={label}>Featuring</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, minHeight: 48, padding: 8, borderRadius: 8, borderWidth: 1,
      borderColor: problem ? theme.danger : focused ? theme.accent : theme.border, backgroundColor: theme.surface, opacity: disabled ? 0.6 : 1 }}>
      {value.map(artist => {
        const name = artist.displayName || artist.handle || artist.did;
        return <View key={artist.did} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 10, borderRadius: 14, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.line }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '600' }}>{name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}${artist.displayName && artist.handle ? ` (@${artist.handle})` : ''}`} disabled={disabled} hitSlop={6}
            onPress={() => onChange(value.filter(item => item.did !== artist.did))} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            <X size={13} color={theme.muted} />
          </Pressable>
        </View>;
      })}
      {!full && <TextInput aria-labelledby={id} accessibilityLabel="Add someone featured" value={draft} editable={!disabled && !resolving}
        onChangeText={text => { setProblem(''); if (text.endsWith(',')) { setDraft(text.slice(0, -1)); void commit(text.slice(0, -1)); } else setDraft(text); }}
        placeholder={value.length ? 'add another' : 'add someone by name or handle'} placeholderTextColor={theme.muted}
        autoCapitalize="none" autoCorrect={false} returnKeyType="done" submitBehavior="submit"
        onSubmitEditing={() => void commit()} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ flexGrow: 1, minWidth: 140, minHeight: 32, paddingHorizontal: 4, color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) }} />}
    </View>
    {options.length > 0 && <View accessibilityRole="list" accessibilityLabel="Artists on plyr.fm"
      style={{ borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, overflow: 'hidden' }}>
      {options.map((hit, at) => <Pressable key={hit.owner.did} accessibilityRole="button" accessibilityLabel={`Add ${hit.owner.display_name || hit.owner.handle}`}
        onPress={() => add({ did: hit.owner.did, handle: hit.owner.handle, displayName: hit.owner.display_name })}
        style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12,
          backgroundColor: pressed ? theme.hover : 'transparent', borderTopWidth: at ? 1 : 0, borderColor: theme.hairline })}>
        <Cover uri={hit.image_url} size={28} round />
        <Text numberOfLines={1} style={[label, { flex: 1 }]}>{hit.owner.display_name || hit.owner.handle}</Text>
        <Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>@{hit.owner.handle}</Text>
      </Pressable>)}
    </View>}
    {problem ? <FieldError>{problem}</FieldError> : resolving ? <Copy live>looking them up…</Copy> : null}
  </View>;
}
