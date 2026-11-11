export const palettes = {
  light: {
    background: '#fafafa', surface: '#ffffff', raised: '#f5f5f5', hover: '#ebebeb',
    text: '#171717', muted: '#525252', faint: '#737373',
    border: '#8a8a8a', line: '#d4d4d4', hairline: '#e5e5e5', danger: '#dc2626',
    card: '#fffffff0', cardBorder: '#00000014', glass: '#fafafabf', glassBorder: '#0000000f'
  },
  dark: {
    background: '#0a0a0a', surface: '#141414', raised: '#1a1a1a', hover: '#1f1f1f',
    text: '#e8e8e8', muted: '#b0b0b0', faint: '#808080',
    border: '#6e6e6e', line: '#333333', hairline: '#282828', danger: '#ef4444',
    card: '#121212e0', cardBorder: '#ffffff0f', glass: '#141414bf', glassBorder: '#ffffff0f'
  }
};

function rgb(hex: string): number[] {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(hex: string): number {
  const channels = rgb(hex).map(value => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function onAccent(accent: string): string {
  return contrast(accent, '#0a0a0a') >= contrast(accent, '#ffffff') ? '#0a0a0a' : '#ffffff';
}

export function readableAccent(color: string, surfaces: string[]): string {
  const source = /^#[0-9a-f]{6}$/i.test(color) ? color : '#6a9fff';
  const channels = rgb(source);
  const endpoint = luminance(surfaces[0]) > 0.5 ? 0 : 255;
  for (let step = 0; step <= 100; step++) {
    const candidate = '#' + channels.map(value => Math.round(value + (endpoint - value) * step / 100).toString(16).padStart(2, '0')).join('');
    if (surfaces.every(surface => contrast(candidate, surface) >= 4.5)) return candidate;
  }
  return endpoint === 0 ? '#000000' : '#ffffff';
}
