import { createElement, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useAppearance } from './appearance';
import { Cover } from './CatalogPieces';
import { Field } from './controls';
import { Text } from './Text';

export interface AccountSuggestion { handle: string; displayName?: string; avatar?: string }

export function AccountPicker({ value, actors, disabled, change, choose, submit }: {
  value: string; actors: AccountSuggestion[]; disabled: boolean;
  change(value: string): void; choose(actor: AccountSuggestion): void; submit(): void;
}) {
  const theme = useAppearance();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const blur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const list = useRef<ScrollViewInstance>(null);
  useEffect(() => { setActive(-1); }, [actors]);
  useEffect(() => () => clearTimeout(blur.current), []);
  const visible = focused && !disabled && actors.length > 0;
  function highlight(index: number) {
    setActive(index);
    list.current?.scrollTo({ y: Math.max(0, index * 64 - 128), animated: false });
  }
  function pick(actor: AccountSuggestion) {
    clearTimeout(blur.current);
    setFocused(false);
    choose(actor);
  }
  const options = actors.map((actor, index) => <Pressable key={actor.handle} nativeID={`account-suggestion-${index}`} role="option"
        accessibilityLabel={actor.displayName ? `${actor.displayName}, @${actor.handle}` : `@${actor.handle}`}
        accessibilityState={{ selected: active === index }} onPress={() => pick(actor)}
        onHoverIn={() => setActive(index)}
        style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10,
          backgroundColor: active === index || pressed ? theme.surface : theme.background })}>
        <Cover round uri={actor.avatar} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {actor.displayName && <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{actor.displayName}</Text>}
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 * theme.scale }}>@{actor.handle}</Text>
        </View>
      </Pressable>);
  return <View style={{ zIndex: 2 }}>
    <Field label="atmosphere account" value={value} onChangeText={text => { setFocused(true); change(text); }} editable={!disabled}
      autoCapitalize="none" autoCorrect={false} autoComplete="off" placeholder="you.example.com"
      accessibilityRole="combobox" aria-expanded={visible} aria-controls="account-suggestions"
      aria-activedescendant={visible && active >= 0 ? `account-suggestion-${active}` : undefined}
      onFocus={() => { clearTimeout(blur.current); setFocused(true); }}
      onBlur={() => { blur.current = setTimeout(() => setFocused(false), 150); }}
      onKeyPress={event => {
        if (Platform.OS !== 'web' || !visible) return;
        const key = event.nativeEvent.key;
        if (key === 'ArrowDown') { event.preventDefault(); highlight(Math.min(active + 1, actors.length - 1)); }
        if (key === 'ArrowUp') { event.preventDefault(); highlight(Math.max(0, active - 1)); }
        if (key === 'Escape') { event.preventDefault(); setFocused(false); }
        if (key === 'Enter' && active >= 0) { event.preventDefault(); pick(actors[active]); }
      }}
      onSubmitEditing={submit} />
    {visible && <ScrollView ref={list} accessibilityRole={Platform.OS === 'web' ? undefined : 'list'} accessibilityLabel="Matching accounts"
      keyboardShouldPersistTaps="handled" style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 288,
        backgroundColor: theme.background, borderWidth: 1, borderColor: theme.surface, borderRadius: 10,
        shadowColor: '#000', shadowOpacity: theme.dark ? 0.3 : 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
      {Platform.OS === 'web' ? createElement('div', { id: 'account-suggestions', role: 'listbox', 'aria-label': 'Matching accounts' }, options) : options}
    </ScrollView>}
  </View>;
}
