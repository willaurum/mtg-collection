// Requires Playwright and Chromium. Run: node tests/test_multiselect_ui.js
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const cards = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
  id: String(index), name, quantity: 3, available: 2, allocated: 1, locations: [],
  set: 'tst', collector_number: String(index),
  card: {id: String(index), name, type_line: 'Creature', cmc: index + 1,
    color_identity: [], prices: {usd: '1.00'}, legalities: {commander: 'legal'}},
}));
const deck = {id: 'deck', name: 'Test deck', cards: cards.map(entry => ({
  card_id: entry.id, card: entry.card, quantity: 1, zone: 'main', proxy: false,
})), count: 3, value: 3, category: ''};
const library = {entries: cards, decks: [deck], wishlist: [], summary: {total: 9, distinct: 3, value: 9}};

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.host !== 'multiselect.test') return route.fulfill({status: 204});
      if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8')});
      if (url.pathname.startsWith('/static/')) {
        const type = url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'image/svg+xml';
        return route.fulfill({contentType: type, body: fs.readFileSync(path.join(root, url.pathname))});
      }
      let body = {};
      if (url.pathname === '/api/library') body = library;
      if (url.pathname === '/api/me') body = {user: 'test', auth: true, local: false};
      if (route.request().method() === 'POST') {
        writes.push({url: url.pathname, ...route.request().postDataJSON()});
        // Verify partial-batch UI with a server ownership rejection.

        body = {entries: cards, decks: [deck], summary: library.summary, wishlist: [],
          completed_ids: writes.length === 1 ? [cards[0].id] : cards.map(card => card.id),
          batch_error: writes.length === 1 ? "No free copies left." : null};
      }
      return route.fulfill({json: body});
    });
    await page.goto('http://multiselect.test/');
    const tiles = page.locator('#collGrid .coll-card');
    await tiles.first().waitFor();
    const bar = page.locator('#collectionPanel .selection-bar');
    await tiles.nth(0).click({modifiers: ['Control']});
    await tiles.nth(2).click({modifiers: ['Shift']});
    assert.equal(await page.locator('#collGrid .card-selected').count(), 3);
    assert.equal(await page.locator('#cardDetailDialog').isVisible(), false);
    await page.locator('#collectionSort').selectOption('quantity');
    assert.equal(await page.locator('#collGrid .card-selected').count(), 3);
    await page.locator('#collectionListBtn').click();
    assert.equal(await page.locator('#collGrid .card-selected').count(), 3);
    await page.locator('#collectionFilter').fill('Alpha');
    assert.equal(await page.locator('#collGrid .card-selected').count(), 1);
    await page.locator('#collectionFilter').fill('');
    assert.equal(await page.locator('#collGrid .card-selected').count(), 1);
    await bar.locator('[data-select-action="all"]').click();
    await page.setViewportSize({width: 900, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await tiles.first().evaluate(tile => {
      const checkbox = tile.querySelector('.card-select').getBoundingClientRect();
      return checkbox.right < tile.querySelector('.thumb').getBoundingClientRect().left;
    }), true, 'list selection control must not cover the thumbnail or quantity');
    if (process.env.MULTISELECT_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.MULTISELECT_SCREENSHOT_DIR, {recursive: true});
      await page.screenshot({path: path.join(process.env.MULTISELECT_SCREENSHOT_DIR, 'collection.png')});
    }
    await bar.locator('[data-select-action="export"]').click();
    assert.match(await page.locator('#deckExportText').inputValue(), /3 Alpha\n3 Beta\n3 Gamma/);
    await page.locator('#deckExportCloseBtn').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#collGrid .card-selected').count(), 3, 'closing a dialog must preserve selection');
    await bar.locator('[data-select-action="add"]').click();
    await page.waitForFunction(() => document.querySelector('#collectionPanel .selection-result').textContent.includes('Stopped:'));
    assert.equal(writes.length, 1);
    assert.equal(await page.locator('#collGrid .card-selected').count(), 2);
    assert.ok(writes.every(write => write.deck_id === 'deck' && write.action === 'add' && write.card_ids.length === 3));
    await page.evaluate(() => openDeck('deck'));
    const deckBar = page.locator('#deckPanel .selection-bar');
    const deckTiles = page.locator('#deckGrid .stack-card');
    await deckTiles.first().focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#deckGrid .card-selected').count(), 1);
    await deckBar.locator('[data-select-action="all"]').click();
    if (process.env.MULTISELECT_SCREENSHOT_DIR) {
      await page.screenshot({path: path.join(process.env.MULTISELECT_SCREENSHOT_DIR, 'deck.png')});
    }
    await deckBar.locator('[data-select-action="remove"]').click();
    assert.equal(writes.length, 1, 'removal requires the inline confirmation');
    await deckBar.locator('[data-select-action="remove"]').click();
    await page.waitForFunction(() => document.querySelector('#deckPanel .selection-result').textContent.includes('3 selected printings updated'));
    assert.ok(writes.slice(1).every(write => write.url === '/api/decks/batch' && write.action === 'remove'));
    await page.keyboard.press('Escape');
    assert.equal(await deckBar.locator('.selection-actions').isVisible(), false);
    await page.evaluate(() => showCollectionView());
    assert.equal(await page.locator('#collGrid .card-selected').count(), 0);
    await tiles.first().click();
    assert.equal(await page.locator('#cardDetailDialog').isVisible(), true, 'ordinary click still opens details');
    await page.evaluate(() => {
      closeCardDetail();
      const base = state.library.entries[0];
      applyLibrary({...state.library, entries: Array.from({length: 5000}, (_, i) => ({
        ...base, id: `large-${i}`, name: `Card ${String(i).padStart(5, '0')}`,
        card: {...base.card, name: `Card ${String(i).padStart(5, '0')}`},
      }))});
    });
    await page.locator('#collectionGridBtn').click();
    assert.ok(await tiles.count() < 100, 'only viewport and overscan tiles should be mounted');
    await tiles.first().click({modifiers: ['Control']});
    await bar.locator('[data-select-action="all"]').click();
    assert.match(await bar.locator('[data-selection-count]').textContent(), /5000 selected/);
    await page.evaluate(() => {
      const scroller = document.querySelector('#collGrid').closest('.view-body');
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForFunction(() => !!document.querySelector('[data-id="large-4999"]'));
    assert.ok(await tiles.count() < 120);
    assert.match(await bar.locator('[data-selection-count]').textContent(), /5000 selected/);
    await page.locator('[data-id="large-4999"]').focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.activeElement?.dataset.id === 'large-0');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.activeElement?.dataset.id === 'large-4999');
    await page.locator('#collectionFilter').fill('Card 00001');
    await page.waitForFunction(() => document.querySelectorAll('#collGrid .coll-card').length === 1);
    assert.match(await bar.locator('[data-selection-count]').textContent(), /1 selected/);
    await page.locator('#collectionFilter').fill('');
    await page.locator('#collectionListBtn').click();
    await page.setViewportSize({width: 850, height: 650});
    assert.ok(await tiles.count() < 120);
    const search = await page.evaluate(() => {
      const entry = state.library.entries[0];
      const cached = entry.searchText;
      applyPatch({entries: [{...entry, card: {...entry.card, oracle_text: 'New searchable text'}}],
        decks: [], summary: state.library.summary});
      return [cached, state.entryById.get(entry.id).searchText];
    });
    assert.ok(!search[0].includes('new searchable text'));
    assert.ok(search[1].includes('new searchable text'));
    assert.deepEqual(errors, []);
    console.log('Multiselect browser checks passed, including 5,000-card windowing, offscreen selection, keyboard navigation, filtering, resizing, and search cache invalidation.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
