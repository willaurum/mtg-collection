// Run with node tests/test_goldfish.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
const start = source.indexOf('function drawOpeningHand(');
const end = source.indexOf('\nfunction renderOpeningHand(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const line = (card_id, quantity, zone = 'main', proxy = false) => ({card_id, quantity, zone, proxy});
const deck = {commander_id: 'commander', cards: [
  line('commander', 1), line('maybe', 10, 'maybeboard'),
  line('land', 5), line('spell', 2), line('proxy', 1, 'main', true),
]};
const before = JSON.stringify(deck);
let result = context.drawOpeningHand(deck, () => 0);
assert.equal(result.total, 8);
assert.equal(result.hand.length, 7);
assert.equal(result.hand.filter(x => x.card_id === 'land').length, 5);
assert.equal(result.hand.filter(x => x.card_id === 'spell').length, 2);
assert.equal(JSON.stringify(deck), before);
result = context.drawOpeningHand(deck, () => 0.999999);
assert.equal(result.hand[0].card_id, 'proxy');
assert.ok(result.hand.every(x => !['commander', 'maybe'].includes(x.card_id)));
assert.equal(JSON.stringify(deck), before);
assert.equal(context.drawOpeningHand({cards: [line('small', 2)]}).hand.length, 2);
assert.equal(context.drawOpeningHand({cards: []}).hand.length, 0);
assert.equal(context.drawOpeningHand({commander_id: 'c', cards: [line('c', 1)]}).total, 0);
console.log('Goldfish checks passed: quantities, exclusions, proxies, redraw, small and empty decks.');
