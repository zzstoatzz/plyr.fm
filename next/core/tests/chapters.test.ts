import assert from 'node:assert/strict';
import test from 'node:test';
import { clock, currentChapter, parseChapters } from '../src/chapters.ts';

const mix = `a sunday mix, enjoy

00:00 H E R B & Kendall Miles - Letting Go
01:35 sleepy fish - before rain
02:58 Otaam x Sitting Duck - Vivid Memories
1:05:10 Mr. Moods - Romantic Ride`;

test('a timestamped tracklist becomes chapters and the rest stays prose', () => {
  const { chapters, prose } = parseChapters(mix, 4000);
  assert.deepEqual(chapters.map(chapter => chapter.start), [0, 95, 178, 3910]);
  assert.deepEqual(chapters[1], { start: 95, label: 'sleepy fish - before rain', artist: 'sleepy fish', title: 'before rain' });
  assert.equal(prose, 'a sunday mix, enjoy');
});

test('bracketed stamps and labels without an artist parse', () => {
  const { chapters } = parseChapters('[0:00] intro\n[2:10] the drop\n[4:00] outro');
  assert.deepEqual(chapters.map(({ start, title, artist }) => [start, title, artist]), [[0, 'intro', undefined], [130, 'the drop', undefined], [240, 'outro', undefined]]);
});

test('anything that is not clearly a tracklist stays plain text', () => {
  for (const [text, duration] of [
    ['recorded at 10:30 pm\nmixed at 11:45 pm', undefined],
    ['0:00 a\n2:00 b', undefined],
    ['0:00 a\n3:00 b\n2:00 c', undefined],
    ['0:00 a\n1:00 b\n9:00 c', 300],
    ['5:00 a\n6:00 b\n7:00 c', undefined],
  ] as const) {
    const parsed = parseChapters(text, duration);
    assert.deepEqual(parsed.chapters, [], text);
    assert.equal(parsed.prose, text.trim());
  }
  assert.deepEqual(parseChapters(undefined), { chapters: [], prose: '' });
});

test('the current chapter follows the playhead', () => {
  const { chapters } = parseChapters(mix);
  assert.equal(currentChapter(chapters, 0), 0);
  assert.equal(currentChapter(chapters, 177), 1);
  assert.equal(currentChapter(chapters, 178), 2);
  assert.equal(currentChapter(chapters, 99999), 3);
  assert.equal(currentChapter(parseChapters('0:30 a\n1:00 b\n2:00 c').chapters, 10), -1);
});

test('clock drops leading zeros and grows hours', () => {
  assert.deepEqual([clock(0), clock(95), clock(3910), clock(-3)], ['0:00', '1:35', '1:05:10', '0:00']);
});
