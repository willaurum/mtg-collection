const assert = require('node:assert/strict');
const G = require('../static/goldfish.js');
const deck = {name: 'Practice', commander_id: 'c', cards: [
  {card_id: 'c', zone: 'main', quantity: 1, card: {name: 'Commander'}},
  {card_id: 'a', zone: 'main', quantity: 10, proxy: true, card: {name: 'A', card_faces: [{name: 'Front'}, {name: 'Back'}]}},
  {card_id: 'b', zone: 'maybeboard', quantity: 4, card: {name: 'Excluded'}},
]};
const original = JSON.stringify(deck);
let game = G.create(deck, () => .5);
assert.equal(game.life, 40);
assert.equal(game.zones.hand.length, 7);
assert.equal(game.zones.library.length, 3);
assert.equal(game.zones.command.length, 1);
assert.equal(Object.keys(game.cards).length, 11);
assert.equal(JSON.stringify(deck), original);
function invariant(state) {
  const ids = Object.values(state.zones).flat();
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, Object.keys(state.cards).length);
  assert.ok(ids.every(id => state.cards[id]));
}
function act(action) {
  const before = JSON.stringify(game);
  const next = G.act(game, action, () => .5);
  assert.equal(JSON.stringify(game), before, 'Actions must not mutate undo snapshots');
  game = next; invariant(game);
}
const id = game.zones.hand[0];
act({type: 'move', id, zone: 'battlefield'});
act({type: 'tap', id}); assert.equal(game.cards[id].tapped, true);
act({type: 'counter', id, delta: 1}); assert.equal(game.cards[id].counters, 1);
act({type: 'flip', id}); assert.equal(game.cards[id].face, 1);
act({type: 'turn'});
assert.equal(game.turn, 2); assert.equal(game.cards[id].tapped, false);
assert.equal(game.zones.hand.length, 7);
act({type: 'move', id, zone: 'graveyard'});
assert.equal(game.cards[id].counters, 0); assert.equal(game.cards[id].face, 0);
act({type: 'move', id, zone: 'exile'});
act({type: 'move', id, zone: 'library', position: 'top'});
assert.equal(game.zones.library[0], id);
act({type: 'draw'}); assert.ok(game.zones.hand.includes(id));
act({type: 'move', id, zone: 'library', position: 'bottom'});
assert.equal(game.zones.library.at(-1), id);
act({type: 'token', name: 'Soldier'});
const token = game.zones.battlefield.at(-1);
assert.equal(game.cards[token].token, true);
act({type: 'removeToken', id: token}); assert.equal(game.cards[token], undefined);
act({type: 'life', delta: -1}); assert.equal(game.life, 39);
act({type: 'mulligan'}); assert.equal(game.zones.hand.length, 7); assert.equal(game.mulligans, 1);
assert.equal(game.zones.command.length, 1);
act({type: 'shuffle'});
for (let i = 0; i < 20; i++) act({type: 'draw'});
assert.equal(game.zones.library.length, 0);
assert.equal(game.zones.hand.length, 10);
const empty = G.create({name: 'Empty', cards: []});
assert.equal(empty.life, 20);
assert.equal(G.act(empty, {type: 'draw'}).zones.hand.length, 0);
assert.equal(G.act(empty, {type: 'mulligan'}).zones.hand.length, 0);
assert.equal(G.act(game, {type: 'move', id, zone: 'invalid'}), game);
console.log('Manual simulator engine checks passed.');

// A group move is one immutable transaction and preserves battlefield state.
let table = G.create(deck, () => .5);
const [one, two] = table.zones.hand;
table = G.act(table, {type: 'batch', actions: [
  {type: 'move', id: one, zone: 'battlefield', x: 123, y: 87},
  {type: 'move', id: two, zone: 'battlefield', x: 160, y: 120},
  {type: 'tap', id: one},
  {type: 'counter', id: one, name: '+1/+1', delta: 2},
  {type: 'faceDown', id: one}
]});
const snapshot = JSON.stringify(table);
const moved = G.act(table, {type: 'batch', actions: [
  {type: 'move', id: one, zone: 'battlefield', x: 231, y: 181},
  {type: 'move', id: two, zone: 'battlefield', x: 268, y: 214}
]});
assert.equal(JSON.stringify(table), snapshot);
assert.equal(moved.cards[one].x, 231);
assert.equal(moved.cards[two].x - moved.cards[one].x, 37);
assert.equal(moved.cards[one].tapped, true);
assert.equal(moved.cards[one].namedCounters['+1/+1'], 2);
assert.equal(moved.cards[one].faceDown, true);
invariant(moved);
const copied = G.act(moved, {type: 'copy', id: one});
const copy = copied.cards[copied.zones.battlefield.at(-1)];
assert.equal(copy.token, true);
assert.notEqual(copy.id, one);
assert.equal(copy.card.name, moved.cards[one].card.name);
invariant(copied);
const cleared = G.act(moved, {type: 'move', id: one, zone: 'hand'});
assert.deepEqual(cleared.cards[one].namedCounters, {});
assert.equal(cleared.cards[one].faceDown, false);
const fresh = G.create(deck, () => .5);
assert.equal(fresh.zones.battlefield.length, 0);
assert.equal(fresh.turn, 1);
console.log('Tabletop positioning, group actions, counters, copies, and fresh-game checks passed.');

for (const zone of G.zones.filter(zone => zone !== 'battlefield')) {
  const seeded = G.act(fresh, {type:'token', card:{name:'Soldier', image_uris:{normal:'token-art'}}, x:200, y:100});
  const tokenId = seeded.zones.battlefield.at(-1);
  assert.equal(seeded.cards[tokenId].card.image_uris.normal, 'token-art');
  assert.equal(seeded.cards[tokenId].x, 200);
  const removed = G.act(seeded, {type:'move', id:tokenId, zone});
  assert.equal(removed.cards[tokenId], undefined);
  assert.ok(!Object.values(removed.zones).flat().includes(tokenId));
  assert.ok(seeded.cards[tokenId], 'Undo snapshot retains the token');
  invariant(removed);
  const repositioned = G.act(seeded, {type:'move', id:tokenId, zone:'battlefield', x:250, y:120});
  assert.equal(repositioned.cards[tokenId].x, 250);
}
const copyRemoved = G.act(copied, {type:'move', id:copy.id, zone:'exile'});
assert.equal(copyRemoved.cards[copy.id], undefined);
invariant(copyRemoved);
console.log('Token art, placement, and removal on every battlefield exit passed.');
