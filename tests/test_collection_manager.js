// Run with node tests/test_collection_manager.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/app.js', 'utf8');
const start = source.indexOf('function collectionComparator(');
const end = source.indexOf('\nfunction managerEntryLabel(', start);
assert.ok(start >= 0 && end > start, 'collection placement functions should exist');

const context = { cardValue: () => 0 };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const entries = [
  { id: 'z', name: 'Zuran Orb', set: 'ice', collector_number: '1', quantity: 1 },
  { id: 'a', name: 'Arcane Signet', set: 'cmm', collector_number: '2', quantity: 2 },
  { id: 'l', name: 'Lightning Bolt', set: 'lea', collector_number: '1', quantity: 1 },
  { id: 'b', name: 'Birds of Paradise', set: 'm10', collector_number: '1', quantity: 1 },
];

let result = context.collectionPlacement(entries, {
  id: 'new', name: 'Counterspell', set: '2xm', collector_number: '45',
});
assert.deepEqual(Array.from(result.before, (entry) => entry.id), ['a', 'b']);
assert.deepEqual(Array.from(result.after, (entry) => entry.id), ['l', 'z']);
assert.equal(result.existing, null);

result = context.collectionPlacement(entries, { id: 'a', name: 'Arcane Signet' });
assert.equal(result.existing.quantity, 2);
assert.deepEqual(Array.from(result.before, (entry) => entry.id), []);
assert.deepEqual(Array.from(result.after, (entry) => entry.id), ['b', 'l']);

result = context.collectionPlacement(entries, {
  id: 'new-printing', name: 'Lightning Bolt', set: 'm11', collector_number: '99',
});
assert.deepEqual(Array.from(result.before, (entry) => entry.id), ['b', 'l']);
assert.deepEqual(Array.from(result.after, (entry) => entry.id), ['z']);

result = context.collectionPlacement([], { id: 'first', name: 'Forest' });
assert.equal(result.before.length, 0);
assert.equal(result.after.length, 0);

const withDeckCards = entries.map((entry) => ({
  ...entry, allocated: entry.id === 'b' || entry.id === 'l' ? 1 : 0,
}));
result = context.collectionPlacement(withDeckCards, {
  id: 'new', name: 'Counterspell', set: '2xm', collector_number: '45',
});
assert.deepEqual(Array.from(result.before, (entry) => entry.id), ['a']);
assert.deepEqual(Array.from(result.after, (entry) => entry.id), ['z']);

result = context.collectionPlacement(withDeckCards, { id: 'l', name: 'Lightning Bolt' });
assert.equal(result.existing.allocated, 1, 'the selected printing should still show its owned count');
assert.deepEqual(Array.from(result.before, (entry) => entry.id), ['a']);
assert.deepEqual(Array.from(result.after, (entry) => entry.id), ['z']);

result = context.collectionPlacement(entries, {
  id: 'new', name: 'Counterspell', set: '2xm', collector_number: '45',
}, [{ cards: [{ card_id: 'b', zone: 'maybeboard', proxy: false }] }]);
assert.deepEqual(Array.from(result.before, (entry) => entry.id), ['a']);
assert.deepEqual(Array.from(result.after, (entry) => entry.id), ['l', 'z']);

console.log('Collection manager placement checks passed.');
