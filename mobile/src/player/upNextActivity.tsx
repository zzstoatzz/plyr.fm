import { Button, HStack, Image, RoundedRectangle, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, aspectRatio, buttonStyle, clipShape, font, foregroundStyle, frame, lineLimit, padding, resizable } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";

export type UpNextActivityRow = {
  target: string;
  title: string;
  by: string;
  /** A file in the App Group the widget extension can read, or "" for the note glyph. */
  art: string;
};

export type UpNextActivityProps = { rows: UpNextActivityRow[]; more: number };

// runs inside the widget extension, with no network and none of the app's modules: everything it draws comes in as props
const UpNext = (props: UpNextActivityProps) => {
  "widget";
  const accent = "#6A9FFF";
  const quiet = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const first = props.rows[0];
  const ahead = props.rows.length + props.more;

  const art = (uri: string, size: number) =>
    uri ? (
      <Image uiImage={uri} modifiers={[resizable(), aspectRatio({ contentMode: "fill" }), frame({ width: size, height: size }), clipShape("roundedRectangle", size / 5)]} />
    ) : (
      <ZStack modifiers={[frame({ width: size, height: size })]}>
        <RoundedRectangle cornerRadius={size / 5} modifiers={[foregroundStyle({ type: "hierarchical", style: "quaternary" })]} />
        <Image systemName="music.note" size={size * 0.45} modifiers={[quiet]} />
      </ZStack>
    );

  const list = (
    <VStack alignment="leading" spacing={5}>
      {props.rows.map((row) => (
        <Button key={row.target} target={row.target} modifiers={[buttonStyle("plain"), accessibilityLabel(`play ${row.title}, by ${row.by}`)]}>
          <HStack spacing={10}>
            {art(row.art, 28)}
            <VStack alignment="leading" spacing={0}>
              <Text modifiers={[font({ size: 14, weight: "semibold" }), lineLimit(1)]}>{row.title}</Text>
              <Text modifiers={[font({ size: 11 }), quiet, lineLimit(1)]}>{row.by}</Text>
            </VStack>
            <Spacer />
          </HStack>
        </Button>
      ))}
    </VStack>
  );
  const heading = (tint: boolean) => <Text modifiers={[font({ size: 13, weight: "semibold" }), tint ? foregroundStyle(accent) : quiet]}>up next</Text>;
  const more = props.more > 0 ? <Text modifiers={[font({ size: 13 }), quiet]}>{`+${props.more} more`}</Text> : null;

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ horizontal: 16, vertical: 12 })]}>
        <HStack>
          {heading(false)}
          <Spacer />
          {more}
        </HStack>
        {list}
      </VStack>
    ),
    compactLeading: art(first?.art ?? "", 22),
    compactTrailing: <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(accent), accessibilityLabel(`${ahead} up next`)]}>{`+${ahead}`}</Text>,
    minimal: art(first?.art ?? "", 20),
    expandedLeading: <HStack modifiers={[padding({ leading: 8 })]}>{heading(true)}</HStack>,
    expandedTrailing: more ? <HStack modifiers={[padding({ trailing: 8 })]}>{more}</HStack> : null,
    expandedBottom: list,
  };
};

export const upNextActivity = createLiveActivity<UpNextActivityProps>("UpNext", UpNext);
