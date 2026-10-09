import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";

export type UpNextProps = {
  /** The track that plays after the current one. */
  next: string;
  nextBy: string;
  /** How many tracks are still ahead in all. */
  ahead: number;
  /** "next from: covers", or empty when the queue is only hand-picked. */
  from: string;
};

// runs inside the widget extension, which has no network and none of the app's modules: everything it draws comes in as props
const UpNext = (props: UpNextProps) => {
  "widget";
  const accent = "#6A9FFF";
  const count = `${props.ahead}`;
  const detail = props.from ? `${props.nextBy} · ${props.from}` : props.nextBy;
  const body = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(accent)]}>up next</Text>
      <Text modifiers={[font({ size: 16, weight: "semibold" }), lineLimit(1)]}>{props.next}</Text>
      <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: "hierarchical", style: "secondary" }), lineLimit(1)]}>{detail}</Text>
    </VStack>
  );
  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 16 })]}>
        <Image systemName="text.line.first.and.arrowtriangle.forward" size={20} color={accent} />
        {body}
        <Spacer />
        <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>{`${count} ahead`}</Text>
      </HStack>
    ),
    compactLeading: <Image systemName="text.line.first.and.arrowtriangle.forward" size={14} color={accent} />,
    compactTrailing: <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(accent)]}>{count}</Text>,
    minimal: <Image systemName="text.line.first.and.arrowtriangle.forward" size={12} color={accent} />,
    expandedLeading: <Image systemName="text.line.first.and.arrowtriangle.forward" size={20} color={accent} />,
    expandedTrailing: <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>{`${count} ahead`}</Text>,
    expandedBottom: body,
  };
};

export const upNextActivity = createLiveActivity<UpNextProps>("UpNext", UpNext);
