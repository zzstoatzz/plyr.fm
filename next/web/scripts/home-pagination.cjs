const assert = require('node:assert/strict');
const { tracks, setup } = require('./fixture-catalog.cjs');

async function homePagination(browser, origin) {
  for (const width of [390, 1280]) {
    const { context, page, errors } = await setup(browser, width, 844, { phone: width === 390 });
    try {
      const first = Array.from({ length: 24 }, (_, index) => ({ ...tracks[0], id: tracks[0].id + index }));
      let secondReads = 0;
      const requests = [];
      await page.route('https://api.next.plyr.fm/v1/tracks?**', route => {
        const query = new URL(route.request().url()).searchParams;
        assert.equal(query.get('tag'), 'ambient');
        const cursor = query.get('cursor');
        requests.push(cursor);
        if (!cursor) return route.fulfill({ json: { data: first, has_more: true, next_cursor: 'next' } });
        if (cursor === 'next') return route.fulfill({ json: { data: [first[0], tracks[1], tracks[1]], has_more: true, next_cursor: 'last' } });
        if (++secondReads === 1) return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: { data: [tracks[2]], has_more: true, next_cursor: 'last' } });
      });
      await page.goto(origin + '/?tag=ambient');
      const rows = page.getByTestId('home-track-row');
      await rows.nth(23).waitFor();
      assert.deepEqual(requests, [null], 'waits until the end of the list approaches');
      assert.equal(await page.getByRole('button', { name: 'load more' }).count(), 0);
      await rows.nth(23).scrollIntoViewIfNeeded();
      await rows.getByText(tracks[1].metadata.title, { exact: true }).waitFor();
      await rows.last().scrollIntoViewIfNeeded();
      const retry = page.getByRole('button', { name: 'try again' });
      await retry.waitFor();
      assert.equal(secondReads, 1, 'stops requesting after a failure');
      await retry.click();
      await rows.getByText(tracks[2].metadata.title, { exact: true }).waitFor();
      assert.equal(await rows.count(), 26, 'keeps existing tracks and removes duplicates');
      assert.deepEqual(requests, [null, 'next', 'last', 'last'], 'stops if a cursor repeats');
      assert.equal(new URL(page.url()).searchParams.get('tag'), 'ambient');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
}

module.exports = homePagination;
