import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, monospacedDigit, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type UploadActivityProps = { title: string; summary: string; detail: string; phase: 'active' | 'done' | 'failed'; progress: number };

// Runs in the widget extension's own runtime: everything it needs is declared inside the function.
const UploadActivity = (props: UploadActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const accent = environment.isLuminanceReduced ? '#ffffff' : '#7ea6ff';
  const tone = props.phase === 'done' ? '#91e5b2' : props.phase === 'failed' ? '#f2c078' : accent;
  const symbol = props.phase === 'done' ? 'checkmark.circle.fill' : props.phase === 'failed' ? 'exclamationmark.triangle.fill' : 'arrow.up.circle.fill';
  const stale = environment.isStale && props.phase === 'active';
  const detail = stale ? 'open plyr.fm to finish uploading' : props.detail;
  const bar = props.phase === 'active'
    ? props.progress >= 0 ? <ProgressView value={props.progress} modifiers={[tint(accent)]} /> : <ProgressView modifiers={[tint(accent)]} />
    : null;
  return {
    banner: <VStack spacing={8} modifiers={[padding({ all: 16 })]}>
      <HStack spacing={12}>
        <Image systemName={symbol} size={26} color={tone} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle('#9a9a9a')]}>{detail}</Text>
        </VStack>
        <Spacer />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit(), foregroundStyle(tone)]}>{props.summary}</Text>
      </HStack>
      {bar}
    </VStack>,
    compactLeading: <Image systemName={symbol} size={15} color={tone} />,
    compactTrailing: <Text modifiers={[font({ size: 12, weight: 'semibold' }), monospacedDigit(), foregroundStyle(tone)]}>{props.summary}</Text>,
    minimal: <Image systemName={symbol} size={14} color={tone} />,
    expandedLeading: <Image systemName={symbol} size={22} color={tone} modifiers={[padding({ leading: 6, top: 6 })]} />,
    expandedTrailing: <Text modifiers={[font({ size: 14, weight: 'semibold' }), monospacedDigit(), foregroundStyle(tone), padding({ trailing: 6, top: 6 })]}>{props.summary}</Text>,
    expandedBottom: <VStack alignment="leading" spacing={6} modifiers={[padding({ horizontal: 8, bottom: 6 })]}>
      <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.title}</Text>
      <Text modifiers={[font({ size: 13 }), foregroundStyle('#9a9a9a')]}>{detail}</Text>
      {bar}
    </VStack>,
  };
};

export default createLiveActivity('UploadActivity', UploadActivity);
