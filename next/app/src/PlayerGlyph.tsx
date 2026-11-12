import type { ComponentType } from 'react';
import Svg, { Path } from 'react-native-svg';

export type Glyph = ComponentType<{ size?: number; color?: string; fill?: string }>;

function glyph(path: string): Glyph {
  return function PlayerGlyph({ size = 24, color = '#000' }) {
    return <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden><Path d={path} /></Svg>;
  };
}

export const PlayGlyph = glyph('M8.5 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.7 4.9a.8.8 0 0 0-1.2.7z');
export const PauseGlyph = glyph('M7.4 5h2.2a.9.9 0 0 1 .9.9v12.2a.9.9 0 0 1-.9.9H7.4a.9.9 0 0 1-.9-.9V5.9a.9.9 0 0 1 .9-.9zM14.4 5h2.2a.9.9 0 0 1 .9.9v12.2a.9.9 0 0 1-.9.9h-2.2a.9.9 0 0 1-.9-.9V5.9a.9.9 0 0 1 .9-.9z');
export const PreviousGlyph = glyph('M6.9 5h.2a.9.9 0 0 1 .9.9v12.2a.9.9 0 0 1-.9.9h-.2a.9.9 0 0 1-.9-.9V5.9a.9.9 0 0 1 .9-.9zM19 5.5v13a.7.7 0 0 1-1.1.6L9 12.6a.7.7 0 0 1 0-1.2l8.9-6.5A.7.7 0 0 1 19 5.5z');
export const NextGlyph = glyph('M17.1 5h-.2a.9.9 0 0 0-.9.9v12.2a.9.9 0 0 0 .9.9h.2a.9.9 0 0 0 .9-.9V5.9a.9.9 0 0 0-.9-.9zM5 5.5v13a.7.7 0 0 0 1.1.6L15 12.6a.7.7 0 0 0 0-1.2L6.1 4.9A.7.7 0 0 0 5 5.5z');
