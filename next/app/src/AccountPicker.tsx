import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
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
  const blur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(blur.current), []);
  const visible = focused && !disabled && actors.length > 0;
  function pick(actor: AccountSuggestion) {
    clearTimeout(blur.current);
    setFocused(false);
    choose(actor);
  }
  const options = actors.map(actor => <Pressable key={actor.handle} role="option"
        accessibilityLabel={actor.displayName ? `${actor.displayName}, @${actor.handle}` : `@${actor.handle}`}
        onPress={() => pick(actor)}
        style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10,
          backgroundColor: pressed ? theme.surface : theme.background })}>
        <Cover round uri={actor.avatar} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {actor.displayName && <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 * theme.scale, fontWeight: '600' }}>{actor.displayName}</Text>}
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 13 * theme.scale }}>@{actor.handle}</Text>
        </View>
      </Pressable>);
  return <View style={{ zIndex: 2 }}>
    <Field label="atmosphere account" value={value} onChangeText={text => { setFocused(true); change(text); }} editable={!disabled}
      autoCapitalize="none" autoCorrect={false} autoComplete="off" placeholder="you.example.com"
      accessibilityRole="combobox" aria-expanded={visible}
      onFocus={() => { clearTimeout(blur.current); setFocused(true); }}
      onBlur={() => { blur.current = setTimeout(() => setFocused(false), 150); }}
      onSubmitEditing={submit} />
    {visible && <ScrollView accessibilityRole="list" accessibilityLabel="Matching accounts"
      keyboardShouldPersistTaps="handled" style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 288,
        backgroundColor: theme.background, borderWidth: 1, borderColor: theme.hairline, borderRadius: 10,
        shadowColor: '#000', shadowOpacity: theme.dark ? 0.3 : 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
      {options}
    </ScrollView>}
  </View>;
}
