/* Manual practice state. No network calls or changes to the saved library. */
(function (root) {
  "use strict";
  const zones = ["library", "hand", "battlefield", "graveyard", "exile", "command"];
  const clone = value => JSON.parse(JSON.stringify(value));
  function shuffle(cards, random = Math.random) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
  function draw(game, count) {
    let drawn = 0;
    while (drawn < count && game.zones.library.length) {
      game.zones.hand.push(game.zones.library.shift());
      drawn++;
    }
    return drawn;
  }
  function create(deck, random = Math.random) {
    const game = { name: deck.name, life: deck.commander_id ? 40 : 20, turn: 1,
      mulligans: 0, nextId: 0, cards: {}, zones: Object.fromEntries(zones.map(z => [z, []])),
      message: "Opening hand drawn. Resolve card rules manually." };
    for (const line of deck.cards.filter(line => line.zone === "main")) {
      for (let i = 0; i < line.quantity; i++) {
        const id = String(game.nextId++);
        game.cards[id] = { id, card: clone(line.card || {}), proxy: !!line.proxy,
          tapped: false, counters: 0, face: 0, token: false };
        game.zones[line.card_id === deck.commander_id ? "command" : "library"].push(id);
      }
    }
    shuffle(game.zones.library, random);
    draw(game, 7);
    return game;
  }
  function act(game, action, random = Math.random) {
    const next = clone(game);
    const card = next.cards[action.id];
    switch (action.type) {
      case "draw":
        next.message = `Drew ${draw(next, 1)} card. ${next.zones.library.length} in library.`;
        break;
      case "shuffle":
        shuffle(next.zones.library, random); next.message = "Library shuffled."; break;
      case "mulligan":
        for (const id of next.zones.hand) {
          if (next.cards[id].token) { delete next.cards[id]; continue; }
          next.cards[id].tapped = false; next.cards[id].counters = 0; next.cards[id].face = 0;
          next.zones.library.push(id);
        }
        next.zones.hand = [];
        shuffle(next.zones.library, random);
        next.mulligans++;
        next.message = `Mulligan ${next.mulligans}: drew ${draw(next, 7)}. Move cards to library bottom manually as your mulligan rules require.`;
        break;
      case "move": {
        if (!card || !zones.includes(action.zone)) return game;
        const from = zones.find(z => next.zones[z].includes(action.id));
        if (from === action.zone && action.zone !== "library") return game;
        next.zones[from] = next.zones[from].filter(id => id !== action.id);
        card.tapped = false; card.counters = 0; card.face = 0;
        if (action.zone === "library" && action.position !== "bottom") next.zones.library.unshift(action.id);
        else next.zones[action.zone].push(action.id);
        next.message = `Moved ${card.card.name || "card"} to ${action.zone}${action.zone === "library" ? ` (${action.position || "top"})` : ""}.`;
        break;
      }
      case "tap":
        if (!card || !next.zones.battlefield.includes(action.id)) return game;
        card.tapped = !card.tapped; next.message = card.tapped ? "Tapped." : "Untapped."; break;
      case "counter":
        if (!card) return game;
        card.counters = Math.max(0, card.counters + action.delta);
        next.message = `Counters: ${card.counters}.`; break;
      case "flip":
        if (!card || !card.card.card_faces || card.card.card_faces.length < 2) return game;
        card.face = card.face ? 0 : 1; next.message = "Card face changed."; break;
      case "life":
        if (!Number.isInteger(action.delta)) return game;
        next.life += action.delta; next.message = `Life: ${next.life}.`; break;
      case "untap":
        next.zones.battlefield.forEach(id => { next.cards[id].tapped = false; });
        next.message = "Untapped battlefield."; break;
      case "turn":
        next.turn++;
        next.zones.battlefield.forEach(id => { next.cards[id].tapped = false; });
        next.message = `Turn ${next.turn}: untapped and drew ${draw(next, 1)}. Resolve upkeep and other effects manually.`;
        break;
      case "token": {
        const name = String(action.name || "Token").trim().slice(0, 80) || "Token";
        const id = String(next.nextId++);
        next.cards[id] = { id, card: { name, type_line: "Token" }, token: true,
          tapped: false, counters: 0, face: 0, proxy: false };
        next.zones.battlefield.push(id); next.message = `Created ${name}.`; break;
      }
      case "removeToken":
        if (!card || !card.token) return game;
        zones.forEach(z => { next.zones[z] = next.zones[z].filter(id => id !== action.id); });
        delete next.cards[action.id]; next.message = "Token removed."; break;
      default: return game;
    }
    return next;
  }
  root.Goldfish = { create, act, zones };
  if (typeof module !== "undefined") module.exports = root.Goldfish;
})(globalThis);
