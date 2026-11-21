import { useEffect, useId, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { addTag, removeTag, suggestTags, tagCatalog, tagList, type TagCount } from '@plyr/next-core/publishing/tag-suggestions';
import { api } from '../api-client';
import { useAppearance } from '../appearance';
import { Copy, inputFontSize } from '../controls';
import { X } from '../icons';
import { Text } from '../Text';

const loadCatalog = tagCatalog((limit, cursor) => api.tags(limit, undefined, cursor));

/** Tags as chips with suggestions from tags already on plyr, like production's tag input. The value stays one tag per line. */
export function TagsField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const theme = useAppearance();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [catalog, setCatalog] = useState<TagCount[]>([]);
  // What's being typed rides along as the value's last line, so Upload and Save include it without a blur.
  const lines = value.split('\n');
  const pending = draft.trim() && lines.at(-1) === draft ? draft : '';
  const committed = pending ? lines.slice(0, -1).join('\n') : value;
  const tags = tagList(committed);
  const suggestions = focused ? suggestTags(catalog, draft, tags) : [];
  const full = tags.length >= 20;

  // A reset from outside (after an upload) clears the half-typed tag too.
  useEffect(() => { if (draft.trim() && value.split('\n').at(-1) !== draft) setDraft(''); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- only an outside change to the value should clear it

  useEffect(() => {
    if (catalog.length) return;
    let live = true;
    loadCatalog().then(found => { if (live) setCatalog(found); }, () => undefined);
    return () => { live = false; };
  }, [catalog.length]);

  function emit(next: string, typing: string) {
    setDraft(typing);
    onChange(typing.trim() ? [next, typing].filter(Boolean).join('\n') : next);
  }

  function commit(tag: string) {
    emit(tag.trim() ? addTag(committed, tag) : committed, '');
  }

  function type(text: string) {
    // A comma or return finishes a tag, as on production.
    const parts = text.split(/[,\n]/u);
    let next = committed;
    for (const part of parts.slice(0, -1)) next = addTag(next, part);
    emit(next, parts.at(-1)!);
  }

  const label = { color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, lineHeight: 22 * theme.scale };
  return <View style={{ gap: 6, minWidth: 0 }}>
    <Text nativeID={id} style={label}>Tags</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, minHeight: 48, padding: 8, borderRadius: 8, borderWidth: 1,
      borderColor: focused ? theme.accent : theme.border, backgroundColor: theme.surface, opacity: disabled ? 0.6 : 1 }}>
      {tags.map(tag => <View key={tag} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 10, borderRadius: 14,
        backgroundColor: theme.accent + '22', borderWidth: 1, borderColor: theme.accent + '55' }}>
        <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale }}>{tag}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${tag}`} disabled={disabled} hitSlop={6}
          onPress={() => emit(removeTag(committed, tag), draft)} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
          <X size={13} color={theme.muted} />
        </Pressable>
      </View>)}
      {!full && <TextInput aria-labelledby={id} accessibilityLabel="Add a tag" value={draft} onChangeText={type} editable={!disabled}
        placeholder={tags.length ? 'add another' : 'add a tag'} placeholderTextColor={theme.muted}
        autoCapitalize="none" autoCorrect={false} returnKeyType="done" submitBehavior="submit"
        onSubmitEditing={() => commit(draft)} onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(draft); }}
        style={{ flexGrow: 1, minWidth: 120, minHeight: 32, paddingHorizontal: 4, color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) }} />}
    </View>
    {suggestions.length > 0 && <View accessibilityRole="list" accessibilityLabel="Existing tags"
      style={{ borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, overflow: 'hidden' }}>
      {suggestions.map((tag, at) => <Pressable key={tag.name} accessibilityRole="button" accessibilityLabel={`Add ${tag.name}`}
        onPress={() => commit(tag.name)}
        style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12,
          backgroundColor: pressed ? theme.hover : 'transparent', borderTopWidth: at ? 1 : 0, borderColor: theme.hairline })}>
        <Text style={label}>{tag.name}</Text>
        <Text style={{ color: theme.muted, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{tag.track_count} {tag.track_count === 1 ? 'track' : 'tracks'}</Text>
      </Pressable>)}
    </View>}
    <Copy>{full ? 'that’s 20 tags, the most a track can have.' : 'type to see tags already on plyr.fm. use ai for AI-generated audio.'}</Copy>
  </View>;
}
