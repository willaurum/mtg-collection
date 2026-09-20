// Run with node tests/test_multiselect.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({Set});
vm.runInContext(fs.readFileSync('static/multiselect.js', 'utf8') + '\nglobalThis.Selection = CardSelection;', context);
const selection = new context.Selection();
const ids = ['a', 'b', 'c', 'd'];
selection.toggle('b', ids);
selection.toggle('d', ids, true);
assert.deepEqual([...selection.ids], ['b', 'c', 'd']);
selection.toggle('c', ids);
assert.deepEqual([...selection.ids], ['b', 'd']);
selection.retain(['d', 'a']);
assert.deepEqual([...selection.ids], ['d'], 'filtered-out cards must not remain selected');
assert.equal(selection.anchor, null);
selection.toggle('a', ['d', 'a'], true);
assert.deepEqual([...selection.ids], ['d', 'a'], 'missing range anchor falls back to toggle');
selection.clear();
assert.equal(selection.ids.size, 0);
assert.equal(selection.active, false);

async function checkBatch(action, failAt) {
  const calls = [], patches = [], result = {};
  const selected = new context.Selection();
  ids.forEach(id => selected.ids.add(id));
  const scope = {kind: action === 'add' ? 'collection' : 'deck', selection: selected,
    bar: {querySelector: selector => selector === '.selection-result' ? result :
      {value: selector === '[data-selection-deck]' ? 'original' : 'maybeboard'}}};
  Object.assign(context, {
    state: {deckId: 'original'}, deckName: id => id,
    applyPatch: data => patches.push(data), setStatus: () => {},
    getJson: async (url, options) => {
      calls.push({url, body: JSON.parse(options.body)});
      context.state.deckId = 'different'; // Navigation during the first request.
      if (calls.length === failAt) throw new Error('Not enough free copies');
      return {ok: true};
    },
  });
  await context.runSelectionBatch(scope, action);
  assert.equal(calls.length, failAt || ids.length, 'stop at the first failure');
  assert.equal(patches.length, failAt ? failAt - 1 : ids.length);
  assert.ok(calls.every(call => call.body.deck_id === 'original'), 'navigation cannot change the destination');
  if (failAt) {
    assert.deepEqual([...selected.ids], ids.slice(failAt - 1), 'keep failed and unattempted rows selected');
    assert.match(result.textContent, /1 of 4 completed/);
  } else assert.equal(selected.ids.size, 0);
  if (action === 'add') assert.ok(calls.every(call => call.body.quantity === 1 && call.body.zone === 'maybeboard'));
  if (action === 'remove') assert.ok(calls.every(call => call.body.all === true));
  if (action === 'main') assert.ok(calls.every(call => call.url === '/api/decks/move' && call.body.zone === 'main'));
}
(async () => {
  await checkBatch('add', 2);
  await checkBatch('remove');
  await checkBatch('main');
  console.log('Multiselect range/filter behavior, partial failures, quantities, and navigation checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
