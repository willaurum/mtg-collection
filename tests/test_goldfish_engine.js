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
