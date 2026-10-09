import Constants from "expo-constants";
import { SymbolView } from "expo-symbols";
import { AT_CLIENTS, resolveClient } from "plyr-shared/atclients";
import { ACCENT_PRESETS, hideTag, playsThroughCollections, showTag } from "plyr-shared/settings";
import { useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { WEB } from "@/config";
import { haptic } from "@/haptics";
import { accentFor } from "@/palette";
import { changeSettings, useAccent, useSettings } from "@/settings";
import { color, inset } from "@/theme";
import { type } from "@/type";

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[type.section, { color: color.ink }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
      {note ? <Text style={[type.meta, styles.note]}>{note}</Text> : null}
    </View>
  );
}

function Row({ title, detail, children, last = false }: { title: string; detail?: string; children?: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.row, last ? null : styles.rule]}>
      <View style={styles.text}>
        <Text style={[type.body, { color: color.ink }]}>{title}</Text>
        {detail ? <Text style={[type.meta, { color: color.muted }]}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Settings kept on this device, under the web's names for them. Plain views, so the screen is the same on any platform. */
export default function Settings() {
  const settings = useSettings();
  const { accent } = useAccent();
  const [typed, setTyped] = useState("");
  const client = resolveClient(settings.ui_settings.atproto_client);
  const through = playsThroughCollections(settings);

  const choose = (change: Parameters<typeof changeSettings>[0]) => {
    haptic.selection();
    changeSettings(change);
  };
  const hide = () => {
    changeSettings((now) => hideTag(now, typed));
    setTyped("");
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <Section title="appearance">
        <Row title="accent color" detail="links, buttons and what is playing" last>
          <View style={styles.swatches} accessibilityRole="radiogroup">
            {ACCENT_PRESETS.map((preset, i) => {
              const stored = i === 0 ? null : preset.value;
              const picked = settings.accent_color === stored;
              return (
                <Pressable
                  key={preset.value}
                  onPress={() => choose((now) => ({ ...now, accent_color: stored }))}
                  accessibilityRole="radio"
                  accessibilityLabel={preset.name}
                  accessibilityState={{ selected: picked }}
                  hitSlop={6}
                >
                  <View style={[styles.swatch, { backgroundColor: accentFor(stored).accent.dark }, picked ? styles.picked : null]} />
                </Pressable>
              );
            })}
          </View>
        </Row>
      </Section>

      <Section title="playback">
        <Row title="play through collections" detail="when you play a track in an album or playlist, keep playing the rest of it" last>
          <Switch
            value={through}
            onValueChange={(on) => changeSettings((now) => ({ ...now, ui_settings: { ...now.ui_settings, play_through_collections: on } }))}
            trackColor={{ true: accent }}
            accessibilityLabel="play through collections"
          />
        </Row>
      </Section>

      <Section title="open links in" note="where an artist’s handle takes you">
        <View accessibilityRole="radiogroup">
          {AT_CLIENTS.map((option, i) => {
            const picked = option.value === client.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => choose((now) => ({ ...now, ui_settings: { ...now.ui_settings, atproto_client: option.value } }))}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: picked }}
              >
                <Row title={option.label} last={i === AT_CLIENTS.length - 1}>
                  {picked ? <SymbolView name="checkmark" size={16} tintColor={accent} /> : null}
                </Row>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="hidden tags" note="tracks with these tags stay out of the feed">
        <View style={styles.tags}>
          {settings.hidden_tags.map((tag) => (
            <Pressable key={tag} onPress={() => choose((now) => showTag(now, tag))} style={styles.tag} accessibilityRole="button" accessibilityLabel={`stop hiding ${tag}`}>
              <Text style={[type.secondary, { color: color.ink }]}>{tag}</Text>
              <SymbolView name="xmark" size={10} tintColor={color.muted} />
            </Pressable>
          ))}
          <View style={[styles.tag, styles.add]}>
            <SymbolView name="plus" size={11} tintColor={color.muted} />
            <TextInput
              style={[type.secondary, styles.input]}
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={hide}
              placeholder="hide a tag"
              placeholderTextColor={color.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              submitBehavior="submit"
              accessibilityLabel="hide a tag"
            />
          </View>
        </View>
      </Section>

      <Section title="about">
        <Row title="version">
          <Text style={[type.body, { color: color.muted }]}>
            {Constants.expoConfig?.version ?? ""}
            {Constants.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ""}
          </Text>
        </Row>
        <Pressable onPress={() => void Linking.openURL(WEB)} accessibilityRole="link" accessibilityLabel="plyr.fm on the web">
          <Row title="plyr.fm on the web" last>
            <SymbolView name="arrow.up.right" size={14} tintColor={color.muted} />
          </Row>
        </Pressable>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: inset, gap: 24, paddingBottom: 60 },
  section: { gap: 8 },
  note: { color: color.muted, paddingHorizontal: 4 },
  card: { backgroundColor: color.surface, borderRadius: 14, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: color.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  text: { flex: 1, gap: 2 },
  swatches: { flexDirection: "row", gap: 8 },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  picked: { borderWidth: 3, borderColor: color.ink },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 18, backgroundColor: color.fill },
  add: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.border },
  input: { color: color.ink, minWidth: 84, paddingVertical: 0 },
});
