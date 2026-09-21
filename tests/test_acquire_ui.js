// Run with node tests/test_acquire_ui.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
const functions = [
  source.slice(source.indexOf('function openDeckDetail('), source.indexOf('async function loadDetailPrintings(')),
  source.slice(source.indexOf('function openWishlistDetail('), source.indexOf('/* ------------------------------------------------------------- decking */')),
].join('\n');
const card = {id: 'printing', name: 'Chosen printing'};
const line = {card_id: card.id, card, proxy: true, quantity: 3, zone: 'main'};
let click, closed = 0, resolveWrite;
const calls = [];
const acquire = {disabled: false, isConnected: true, addEventListener: (type, handler) => {click = handler;}};
const actions = {
  innerHTML: '', querySelectorAll: () => [],
  querySelector(selector) {
    if (selector === '[data-detail-acquire]') return this.innerHTML.includes('data-detail-acquire') ? acquire : null;
    return {addEventListener() {}};
  },
};
const context = vm.createContext({
  ui: {detailActions: actions},
  state: {library: {wishlist: [{id: card.id, card, quantity: 3, proxy_quantity: 3, manual_quantity: 0}]}},
  deckById: () => ({cards: [line]}), lineCard: () => card,
  hideCardPreview() {}, detailBase() {}, canBeCommander: () => false, canBeCompanion: () => false,
  loadDetailPrintings() {}, closeCardDetail: () => {closed++;},
  mutate: (url, payload, success) => {
    calls.push({url, payload, success});
    return new Promise(resolve => {resolveWrite = resolve;});
  },
});
vm.runInContext(functions, context);
(async () => {
  context.openWishlistDetail(card.id);
  assert.match(actions.innerHTML, /Add one to collection/);
  const wishWrite = click();
  assert.equal(acquire.disabled, true);
  await click();
  assert.equal(calls.length, 1, 'ignore double clicks while saving');
  assert.equal(calls[0].url, '/api/collection/add');
  assert.equal(calls[0].payload.card.id, card.id);
  assert.equal(calls[0].payload.quantity, 1);
  resolveWrite(null);
  await wishWrite;
  assert.equal(acquire.disabled, false, 'failure leaves the dialog open and allows retry');
  assert.equal(closed, 0);
  context.openDeckDetail('original-deck', card.id);
  assert.match(actions.innerHTML, /Add to collection &amp; use/);
  const deckWrite = click();
  assert.equal(calls[1].url, '/api/decks/acquire-proxy');
  assert.equal(calls[1].payload.deck_id, 'original-deck');
  assert.equal(calls[1].payload.card_id, card.id);
  assert.match(calls[1].success({added_quantity: 2}), /Added 2 copies/);
  resolveWrite({added_quantity: 2});
  await deckWrite;
  assert.equal(closed, 1);
  line.proxy = false;
  context.openDeckDetail('original-deck', card.id);
  assert.doesNotMatch(actions.innerHTML, /data-detail-acquire/, 'owned rows do not offer proxy acquisition');
  console.log('Wishlist and deck acquisition controls, errors, and double-click checks passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
