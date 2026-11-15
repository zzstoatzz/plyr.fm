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
      const chartReads = [];
      const rankings = { month: [tracks[0]], week: [tracks[1]], day: [], all_time: [tracks[2]] };
      await page.route('https://api.next.plyr.fm/v1/charts/tracks?**', route => {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('limit') !== '10') return route.fallback();
        const period = query.get('period');
        chartReads.push(period);
        if (period === 'week' && chartReads.filter(read => read === 'week').length === 1) return route.fulfill({ status: 503 });
        return route.fulfill({ json: { period, data: rankings[period].map(track => ({ track })) } });
      });
      await page.goto(origin + '/?tag=ambient');
      const rows = page.getByTestId('home-track-row');
      await rows.nth(23).waitFor();
      assert.deepEqual(requests, [null], 'waits until the end of the list approaches');
      assert.equal(await page.getByRole('button', { name: 'load more' }).count(), 0);
      assert.equal(await page.evaluate(() => getComputedStyle(document.scrollingElement).scrollbarWidth),
        width === 390 ? 'none' : 'auto', 'the page scrollbar is only hidden on narrow touch screens');
      await page.mouse.move(width / 2, 320);
      await page.mouse.wheel(0, 450);
      await page.waitForFunction(() => window.scrollY > 0);
      await rows.nth(23).scrollIntoViewIfNeeded();
      await rows.getByText(tracks[1].metadata.title, { exact: true }).waitFor();
      await rows.last().scrollIntoViewIfNeeded();
      const retry = page.getByRole('button', { name: 'try again' });
      await retry.waitFor();
      assert.equal(secondReads, 1, 'stops requesting after a failure');
      await retry.press('Enter');
      const appended = rows.getByRole('link', { name: tracks[2].metadata.title, exact: true });
      await appended.waitFor();
      assert.equal(await appended.evaluate(node => document.activeElement === node), true);
      assert.equal(await rows.count(), 26, 'keeps existing tracks and removes duplicates');
      assert.deepEqual(requests, [null, 'next', 'last', 'last'], 'stops if a cursor repeats');
      assert.equal(new URL(page.url()).searchParams.get('tag'), 'ambient');
      const chart = page.getByTestId('home-chart');
      const period = label => chart.getByRole('button', { name: new RegExp('^top tracks period: ' + label) });
      await chart.getByRole('link', { name: tracks[0].metadata.title, exact: true }).waitFor();
      await period('past month').press('Enter');
      await chart.getByText('could not load top tracks').waitFor();
      await chart.getByRole('button', { name: 'try again' }).press('Enter');
      await chart.getByRole('link', { name: tracks[1].metadata.title, exact: true }).waitFor();
      assert.equal(await period('past week').evaluate(node => document.activeElement === node), true);
      await period('past week').click();
      await chart.getByText('no top tracks for this period').waitFor();
      await period('past day').click();
      const topTrack = chart.getByRole('link', { name: tracks[2].metadata.title, exact: true });
      await topTrack.waitFor();
      await period('all time').click();
      await chart.getByRole('link', { name: tracks[0].metadata.title, exact: true }).waitFor();
      assert.deepEqual(chartReads, ['month', 'week', 'week', 'day', 'all_time', 'month']);
      for (const label of ['past month', 'past week', 'past day']) await period(label).click();
      await topTrack.click();
      await page.waitForURL('**/track/' + tracks[2].id);
      await page.goBack();
      await period('all time').waitFor();
      await topTrack.waitFor();
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
}

module.exports = homePagination;
