import assert from 'node:assert/strict';
import test from 'node:test';
import { tagColors, tagHue } from '../src/tag-colors.ts';
import { contrast, palettes } from '../src/colors.ts';

test('tag hues retain the production mapping', () => {
  assert.equal(tagHue('a'), 97);
  assert.equal(tagHue('ab'), 225);
});

test('tag colors stay distinct and readable in both themes and selection states', () => {
  const tags = ['electronic', 'asynchronous', 'audio theater', 'audiobook', 'experimental', 'garageband', 'zine', 'ballad', '東京'];
  for (const palette of Object.values(palettes)) {
    const colors = new Set<string>();
    for (const name of tags) for (const selected of [false, true]) {
      const result = tagColors(name, palette.background, selected);
      assert.ok(contrast(result.color, result.backgroundColor) >= 4.5, `${name}/${selected} readable on ${palette.background}`);
      colors.add(result.color);
    }
    assert.ok(colors.size >= 6, 'tags have a varied palette');
    assert.notEqual(tagColors('electronic', palette.background, false).backgroundColor, tagColors('electronic', palette.background, true).backgroundColor);
  }
});
