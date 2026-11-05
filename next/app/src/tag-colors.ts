import { readableAccent } from './colors.ts';

export function tagHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  return ((hash % 360) + 360) % 360;
}

function tint(hue: number): string {
  const component = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (0.5 - 0.3 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${component(0)}${component(8)}${component(4)}`;
}

function blend(color: string, background: string, alpha: number): string {
  return '#' + [1, 3, 5].map(offset => Math.round(parseInt(color.slice(offset, offset + 2), 16) * alpha + parseInt(background.slice(offset, offset + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

export function tagColors(name: string, background: string, selected: boolean) {
  const base = tint(tagHue(name));
  const fill = blend(base, background, selected ? 0.22 : 0.09);
  const color = readableAccent(base, [fill]);
  return { color, backgroundColor: fill, borderColor: selected ? color : blend(base, background, 0.3) };
}
