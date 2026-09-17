// Run with Node and Playwright installed: node tests/test_scanner.cjs
// Synthetic webcam + OCR let us check duplicate prevention without a real camera.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.SCANNER_BROWSER || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const original = { id: 'bolt-a', name: 'Lightning Bolt', set: 'lea', set_name: 'Limited Edition Alpha',
      collector_number: '161', released_at: '1993-08-05', mana_cost: '{R}', type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.', prices: { usd: '10.00' },
      prints_search_uri: 'https://api.scryfall.com/cards/search?test=1', image_uris: { normal: 'https://example.com/card.png' } };
    const alternate = { ...original, id: 'bolt-b', set: 'm11', set_name: 'Magic 2011', collector_number: '149' };
    let entries = [], adds = 0, failAdd = false, failLookup = false, slowLookup = false, failPrintings = false;
    const lookupNames = [];
    const summary = () => ({ total: adds, distinct: entries.length, free: adds, allocated: 0, value: adds * 10 });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') {
        if (process.env.SCANNER_REAL_OCR && (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com')) return route.continue();
        return route.abort();
      }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8') });
      if (url.pathname.startsWith('/static/')) return route.fulfill({
        path: path.join(root, url.pathname), contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
      if (url.pathname === '/img') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680"><rect width="488" height="680" fill="#85442c"/><text x="25" y="60" fill="white" font-size="30">Lightning Bolt</text></svg>' });
      let data = {};
      if (url.pathname === '/api/me') data = { username: 'Scanner test', local: true };
      if (url.pathname === '/api/library') data = { entries, decks: [], summary: summary() };
      if (url.pathname === '/api/card') {
        lookupNames.push(url.searchParams.get('name'));
        if (slowLookup) await new Promise(resolve => setTimeout(resolve, 700));
        if (failLookup) return route.fulfill({ status: 404, json: { error: 'No matching card.' } });
        data = original;
      }
      if (url.pathname === '/api/printings') {
        if (failPrintings) return route.fulfill({ status: 502, json: { error: 'Offline' } });
        data = [original, alternate];
      }
      if (url.pathname === '/api/collection/add') {
        if (failAdd) return route.fulfill({ status: 500, json: { error: 'Could not save.' } });
        const { card, quantity } = route.request().postDataJSON();
        assert.equal(quantity, 1); adds++;
        const old = entries.find(entry => entry.id === card.id);
        const entry = { id: card.id, name: card.name, card, quantity: (old?.quantity || 0) + 1, available: adds, locations: [], added: '2026-09-16' };
        entries = [...entries.filter(item => item.id !== card.id), entry];
        data = { entries: [entry], decks: [], removed_entries: [], summary: summary() };
      }
      return route.fulfill({ json: data });
    });
    await page.addInitScript(({ realOcr }) => {
      window.testOcrCalls = 0;
      window.testTerminations = 0;
      window.testTracks = [];
      if (!realOcr) window.Tesseract = { createWorker: async () => ({
        setParameters: async () => {},
        recognize: async () => { window.testOcrCalls++; return { data: { text: 'Lightning Bolt', confidence: 95 } }; },
        terminate: async () => { window.testTerminations++; },
      }) };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        if (window.testDenyCamera) throw new DOMException('Denied', 'NotAllowedError');
        const canvas = document.createElement('canvas');
        canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d');
        window.testFrame = present => {
          ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 1280, 720);
          if (present) {
            ctx.fillStyle = '#eee'; ctx.fillRect(434, 72, 412, 576);
            ctx.fillStyle = '#222'; ctx.fillRect(460, 150, 350, 240);
            ctx.font = '26px serif'; ctx.fillText('Lightning Bolt', 460, 120);
          }
        };
        window.testFrame(false);
        const stream = canvas.captureStream(15);
        window.testTracks.push(...stream.getTracks());
        return stream;
      } });
    }, { realOcr: !!process.env.SCANNER_REAL_OCR });
    await page.goto('http://localhost/');
    const status = page.locator('#scannerStatus');
    const waitText = text => page.waitForFunction(text => document.getElementById('scannerStatus').textContent.includes(text), text);
    await page.click('#scannerBtn');
    await page.waitForFunction(() => !document.getElementById('scannerCalibrate').disabled, null, { timeout: 90000 });
    await page.click('#scannerCalibrate');
    await page.evaluate(() => window.testFrame(true));
    await page.locator('#scannerReview').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('scannerPrintings').options.length === 2);
    assert.equal(await page.locator('#scannerName').textContent(), 'Lightning Bolt');
    if (process.env.SCANNER_REAL_OCR) {
      assert.match(lookupNames.at(-1), /^Lightning Bolt$/i);
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      console.log('Real OCR smoke check passed: downloaded worker/model and recognized the synthetic webcam title.');
      return;
    }
    await page.selectOption('#scannerPrintings', 'bolt-b');
    await page.locator('#scannerPrintings').focus();
    fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.cache/scanner-review.png') });
    // Repeated Enter events and a card left in view must never create another add.
    await page.keyboard.press('Enter');
    await waitText('Remove the card');
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })));
    await page.waitForTimeout(3200);
    assert.equal(adds, 1);
    assert.equal(entries[0].id, 'bolt-b');
    assert.equal(await page.locator('#scannerReview').isVisible(), false);
    assert.equal(await page.evaluate(() => window.testOcrCalls), 1);
    // Remove it, then present the very same card: it is accepted as the next copy.
    await page.evaluate(() => window.testFrame(false));
    await waitText('Ready for the next card');
    await page.evaluate(() => window.testFrame(true));
    await page.locator('#scannerReview').waitFor({ state: 'visible' });
    await page.keyboard.press('Enter');
    await waitText('Remove the card');
    assert.equal(adds, 2);
    // R explicitly recovers a miss without requiring the card to leave again.
    await page.keyboard.press('r');
    await page.locator('#scannerReview').waitFor({ state: 'visible' });
    failAdd = true;
    await page.keyboard.press('Enter');
    await waitText('Could not confirm');
    assert.equal(adds, 2);
    assert.equal(await page.locator('#scannerReview').isVisible(), true);
    failAdd = false;
    failLookup = true;
    await page.fill('#scannerSearch', 'Wrong name');
    await page.press('#scannerSearch', 'Enter');
    await waitText('Could not find');
    assert.equal(adds, 2);
    failLookup = false; failPrintings = true;
    await page.fill('#scannerSearch', 'Lightning Bolt');
    await page.press('#scannerSearch', 'Enter');
    await page.waitForFunction(() => document.getElementById('scannerPrintingStatus').textContent.includes('could not load'));
    assert.equal(await page.locator('#scannerAdd').isEnabled(), true);
    failPrintings = false;
    // Closing during lookup must stop camera/worker and ignore its late result.
    slowLookup = true;
    await page.fill('#scannerSearch', 'Lightning Bolt');
    await page.click('#scannerFind');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#scannerDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => window.testTracks.every(track => track.readyState === 'ended')), true);
    assert.equal(await page.evaluate(() => window.testTerminations), 1);
    await page.evaluate(() => { window.testDenyCamera = true; });
    await page.click('#scannerBtn');
    await waitText('permission was denied');
    assert.equal(await page.locator('#scannerCalibrate').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log('Scanner browser checks passed: recognition, printing choice, Enter, duplicate gate, identical copies, rescan, errors, and cleanup.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
