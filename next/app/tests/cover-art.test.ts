import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { artworkName, artworkPlan, artworkType, MAX_ARTWORK_BYTES } from '../src/publishing/artwork-model.ts';

test('covers the lexicon takes are kept as picked', () => {
  assert.deepEqual(artworkPlan({ type: 'image/png', size: 400_000 }, 1400, 1400), { keep: true });
  assert.deepEqual(artworkPlan({ type: 'image/jpg', size: 2_000_000 }, 3000, 2000), { keep: true });
  assert.deepEqual(artworkPlan({ type: 'image/gif', size: 9_000_000 }, 6000, 6000), { keep: true }, 'a GIF keeps its animation');
});

test('iPhone HEIC photos, odd formats and oversized images become a JPEG of at most 2000 px', () => {
  assert.deepEqual(artworkPlan({ type: 'image/heic', size: 3_000_000 }, 4032, 3024), { keep: false, width: 2000 });
  assert.deepEqual(artworkPlan({ type: 'image/heic', size: 3_000_000 }, 3024, 4032), { keep: false, width: 1500 });
  assert.deepEqual(artworkPlan({ type: 'image/heif', size: 900_000 }, 1200, 1200), { keep: false });
  assert.deepEqual(artworkPlan({ type: 'image/tiff', size: 900_000 }), { keep: false, width: 2000 }, 'unknown size still bounds the output');
  assert.deepEqual(artworkPlan({ type: 'image/jpeg', size: MAX_ARTWORK_BYTES + 1 }, 1800, 1800), { keep: false });
  assert.deepEqual(artworkPlan({ type: 'image/png', size: 5_000_000 }, 8000, 8000), { keep: false, width: 2000 });
  assert.deepEqual(artworkPlan({ type: '', size: 10 }), { keep: false, width: 2000 });
});

test('converted covers are named as JPEGs and types are normalized', () => {
  assert.equal(artworkName('IMG_4821.HEIC'), 'IMG_4821.jpg');
  assert.equal(artworkName('.heic'), 'cover.jpg');
  assert.equal(artworkType('image/JPG; charset=binary'), 'image/jpeg');
});
