import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useAppearance } from '../appearance';
import { Cover } from '../CatalogPieces';
import { inputFontSize } from '../controls';
import { MagnifyingGlass, Plus, X } from '../icons';
import { Text } from '../Text';
import { memberDid } from './policy-pds';

/** someone picked to listen; name and face are filled in when known */
export interface Person { did: string; handle?: string; name?: string; avatar?: string }

const typeahead = 'https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead';
const label = (person: Person) => person.name ?? (person.handle ? `@${person.handle}` : 'someone');

/** pick people by searching for them; each becomes a removable chip, never a typed list */
export function PeoplePicker({ people, change, owner, disabled }: { people: Person[]; change: (people: Person[]) => void; owner?: string; disabled?: boolean }) {
  const theme = useAppearance();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [error, setError] = useState<string>();
  const [focused, setFocused] = useState(false);
  const text = query.trim().replace(/^@/, '');
  useEffect(() => {
    setResults([]);
    if (text.length < 2 || text.startsWith('did:')) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`${typeahead}?${new URLSearchParams({ q: text, limit: '6' })}`, { signal: controller.signal, headers: { 'X-Client': 'next.plyr.fm' } })
        .then(async response => {
          if (!response.ok || controller.signal.aborted) return;
          const found = await response.json() as { actors?: { did: string; handle: string; displayName?: string; avatar?: string }[] };
          if (!controller.signal.aborted) setResults((found.actors ?? []).map(actor => ({ did: actor.did, handle: actor.handle, name: actor.displayName?.trim() || undefined, avatar: actor.avatar })));
        }).catch(() => {});
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text]);
  const picked = new Set(people.map(person => person.did));
  const shown = results.filter(person => !picked.has(person.did) && person.did !== owner);
  function add(person: Person) {
    if (!picked.has(person.did) && person.did !== owner) change([...people, person]);
    setQuery(''); setError(undefined);
  }
  /** submit with no match: take the text as a handle or DID */
  async function addTyped() {
    if (!text) return;
    if (shown[0]) { add(shown[0]); return; }
    try {
      const did = await memberDid(text);
      if (did === owner) setError('you can always listen to your own tracks.');
      else add({ did, handle: text.startsWith('did:') ? undefined : text });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'could not find that account.'); }
  }
  const small = { color: theme.muted, fontSize: 12 * theme.scale };
  return <View style={{ gap: 10 }}>
    {people.length > 0 && <View accessibilityLabel="People who can listen" style={styles.chips}>
      {people.map(person => <View key={person.did} style={[styles.chip, { backgroundColor: theme.raised }]}>
        <Cover uri={person.avatar} size={26} round instant />
        <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.text, fontSize: 14 * theme.scale, fontWeight: '600' }}>{label(person)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label(person)}`} disabled={disabled} hitSlop={6}
          onPress={() => change(people.filter(other => other.did !== person.did))} style={styles.remove}>
          <X size={14} color={theme.muted} />
        </Pressable>
      </View>)}
    </View>}
    <View style={[styles.search, { backgroundColor: theme.raised, borderColor: error ? theme.danger : focused ? theme.accent : theme.line }]}>
      <MagnifyingGlass size={18} color={theme.muted} />
      <TextInput accessibilityLabel="Add a person" value={query} onChangeText={value => { setQuery(value); setError(undefined); }} editable={!disabled}
        placeholder="search for someone" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} returnKeyType="done"
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSubmitEditing={() => void addTyped()}
        style={{ flex: 1, minHeight: 44, color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) }} />
    </View>
    {shown.length > 0 && <View accessibilityLabel="Matching people" style={[styles.results, { borderColor: theme.line, backgroundColor: theme.surface }]}>
      {shown.map(person => <Pressable key={person.did} accessibilityRole="button" accessibilityLabel={`Add ${label(person)}`} onPress={() => add(person)}
        style={({ pressed }) => [styles.result, pressed && { backgroundColor: theme.hover }]}>
        <Cover uri={person.avatar} size={36} round instant />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{person.name ?? `@${person.handle}`}</Text>
          {person.name && person.handle ? <Text numberOfLines={1} style={small}>@{person.handle}</Text> : null}
        </View>
        <Plus size={18} color={theme.muted} />
      </Pressable>)}
    </View>}
    {error && <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, fontSize: 14 * theme.scale }}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '100%', paddingLeft: 4, borderRadius: 999 },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5 },
  results: { borderWidth: 1, borderRadius: 10, padding: 4 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 8, borderRadius: 8 },
});
