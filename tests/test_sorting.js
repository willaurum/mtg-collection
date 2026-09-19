// Run with node tests/test_sorting.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/app.js', 'utf8');
const html = fs.readFileSync('templates/index.html', 'utf8');

const groupsStart = source.indexOf('function wishlistGroups(');
const groupsEnd = source.indexOf('\nfunction wishlistTileHtml(', groupsStart);
const groupsContext = {};
vm.createContext(groupsContext);
vm.runInContext(source.slice(groupsStart, groupsEnd), groupsContext);
const grouped = groupsContext.wishlistGroups([
  {
    id: 'shared', name: 'Shared', manual_quantity: 3, proxy_quantity: 1, quantity: 3,
    proxy_decks: [{ deck_id: 'z', deck_name: 'Zombies', quantity: 1 }],
  },
  {
    id: 'proxy', name: 'Proxy', manual_quantity: 0, proxy_quantity: 2, quantity: 2,
    proxy_decks: [{ deck_id: 'a', deck_name: 'Artifacts', quantity: 2 }],
  },
]);
assert.equal(grouped.map((group) => group.name).join('|'), 'Not in a deck|Artifacts|Zombies');
assert.equal(grouped[0].items[0].quantity, 2, 'deck-covered copies should not be duplicated as manual wishes');
assert.equal(grouped.flatMap((group) => group.items).reduce((sum, item) => sum + item.quantity, 0), 5);

const wishlistStart = source.indexOf('function wishlistComparator(');
const wishlistEnd = source.indexOf('\nfunction setWishlistSort(', wishlistStart);
const wishlistContext = {
  cardValue: (item) => Number(item.card?.prices?.usd) || 0,
};
vm.createContext(wishlistContext);
vm.runInContext(source.slice(wishlistStart, wishlistEnd), wishlistContext);

const wishes = [
  { name: 'Beta', quantity: 1, set: 'two', card: { cmc: 2, prices: { usd: '8' } } },
  { name: 'Alpha', quantity: 3, set: 'one', card: { cmc: 4, prices: { usd: '2' } } },
];
assert.deepEqual([...wishes].sort(wishlistContext.wishlistComparator('name')).map((x) => x.name), ['Alpha', 'Beta']);
assert.deepEqual([...wishes].sort(wishlistContext.wishlistComparator('mana')).map((x) => x.name), ['Beta', 'Alpha']);
assert.deepEqual([...wishes].sort(wishlistContext.wishlistComparator('price')).map((x) => x.name), ['Beta', 'Alpha']);
assert.deepEqual([...wishes].sort(wishlistContext.wishlistComparator('quantity')).map((x) => x.name), ['Alpha', 'Beta']);

const deckStart = source.indexOf('function deckItemComparator(');
const deckEnd = source.indexOf('\nfunction setDeckSort(', deckStart);
const deckContext = {
  lineName: (line) => line.name,
};
vm.createContext(deckContext);
vm.runInContext(source.slice(deckStart, deckEnd), deckContext);

const deckItems = [
  { line: { name: 'Beta', quantity: 1 }, card: { cmc: 2, rarity: 'rare', prices: { usd: '8' } } },
  { line: { name: 'Alpha', quantity: 3 }, card: { cmc: 4, rarity: 'common', prices: { usd: '2' } } },
];
assert.deepEqual([...deckItems].sort(deckContext.deckItemComparator('name')).map((x) => x.line.name), ['Alpha', 'Beta']);
assert.deepEqual([...deckItems].sort(deckContext.deckItemComparator('mana')).map((x) => x.line.name), ['Beta', 'Alpha']);
assert.deepEqual([...deckItems].sort(deckContext.deckItemComparator('price')).map((x) => x.line.name), ['Beta', 'Alpha']);
assert.deepEqual([...deckItems].sort(deckContext.deckItemComparator('quantity')).map((x) => x.line.name), ['Alpha', 'Beta']);
assert.deepEqual([...deckItems].sort(deckContext.deckItemComparator('rarity')).map((x) => x.line.name), ['Beta', 'Alpha']);

assert.match(source, /name: "Not in a deck"/);
assert.match(source, /Proxy cards needed by this deck/);
assert.match(source, /data-wishlist-export/);
assert.match(source, /function exportWishlistGroup\(/);
assert.match(html, /id="deckSort"/);
assert.doesNotMatch(source, /data-deck-column-sort/);
console.log('Wishlist and deck sorting checks passed.');
