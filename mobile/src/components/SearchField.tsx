import { SymbolView } from "expo-symbols";
import { SEARCH_MAX_LENGTH } from "plyr-shared/search";
import { StyleSheet, TextInput, View } from "react-native";
import { color, inset } from "@/theme";
import { type } from "@/type";

/** The search tab's field, drawn in the shape of the system's so it can sit directly under the title. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  return (
    <View style={styles.field}>
      <SymbolView name="magnifyingglass" size={18} tintColor={color.muted} />
      <TextInput
        style={[type.body, styles.input]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        maxLength={SEARCH_MAX_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        accessibilityLabel="search"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    marginHorizontal: inset - 4,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: color.fill,
  },
  input: { flex: 1, height: 44, color: color.ink },
});
