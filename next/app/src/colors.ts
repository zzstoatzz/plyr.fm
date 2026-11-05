export const palettes = {
  light: { background: '#fbfbfd', surface: '#eceef4', text: '#141826', muted: '#50596b', border: '#788399', danger: '#b42335' },
  dark: { background: '#10131a', surface: '#202735', text: '#f4f6fa', muted: '#b7c2d5', border: '#73839a', danger: '#ff99a5' }
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
