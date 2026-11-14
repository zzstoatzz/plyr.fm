import assert from 'node:assert/strict';
import test from 'node:test';
import { contrast, onAccent, palettes, readableAccent } from '../src/colors.ts';

test('text, field boundaries and arbitrary chosen accents stay legible on both surfaces', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#788399', '#788399'), 1);
  assert.ok(contrast('#777777', '#ffffff') < 4.5);
  assert.ok(contrast('#767676', '#ffffff') > 4.5);
  for (const palette of Object.values(palettes)) {
    const surfaces = [palette.background, palette.surface];
    for (const surface of surfaces) {
      for (const color of [palette.text, palette.muted, palette.faint, palette.danger]) assert.ok(contrast(color, surface) >= 4.5, `${color} on ${surface}`);
      assert.ok(contrast(palette.border, surface) >= 3, `${palette.border} boundary on ${surface}`);
    }
    for (const source of ['#6a9fff', '#4ade80', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316', '#000000', '#ffffff', '#808080', '#202735']) {
      const adjusted = readableAccent(source, surfaces);
      for (const surface of surfaces) assert.ok(contrast(adjusted, surface) >= 4.5, `${source} → ${adjusted} on ${surface}`);
      assert.ok(contrast(onAccent(adjusted), adjusted) >= 4.5, `${onAccent(adjusted)} on ${adjusted}`);
      assert.equal(readableAccent(adjusted, surfaces), adjusted, 'Already legible accents stay unchanged');
    }
  }
});
