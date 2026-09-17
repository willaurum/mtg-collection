/* Sessions survive closing the dialog, but reset when the page is reloaded. */
const practiceSessions = new Map();
let practiceSession = null;
let practiceSelected = null;
let practiceZone = "hand";
let practiceWired = false;

function startPractice(deck) {
  if (!practiceSessions.has(deck.id)) {
    practiceSessions.set(deck.id, { game: Goldfish.create(deck), history: [] });
  }
  practiceSession = practiceSessions.get(deck.id);
  practiceSelected = null;
  practiceZone = "hand";
  if (!practiceWired) {
    el("practiceControls").addEventListener("click", event => {
      const button = event.target.closest("[data-practice]");
      if (button) practiceAction({ type: button.dataset.practice });
    });
    el("practiceZones").addEventListener("click", event => {
      const button = event.target.closest("[data-zone]");
      if (!button) return;
      practiceZone = button.dataset.zone;
      practiceSelected = null;
      renderPractice();
    });
    el("goldfishHand").addEventListener("click", event => {
      const button = event.target.closest("[data-card]");
      if (!button) return;
      practiceSelected = button.dataset.card;
      renderPractice();
      el("practiceMove").focus();
    });
    el("practiceCardActions").addEventListener("click", event => {
      const button = event.target.closest("[data-card-action]");
      if (!button) return;
      const type = button.dataset.cardAction;
      const action = { type, id: practiceSelected };
      if (type === "counter") action.delta = Number(button.dataset.delta);
      if (type === "move") {
        const [zone, position] = el("practiceDestination").value.split(":");
        action.zone = zone; action.position = position;
      }
      practiceAction(action);
    });
    el("practiceLifeDown").onclick = () => practiceAction({ type: "life", delta: -1 });
    el("practiceLifeUp").onclick = () => practiceAction({ type: "life", delta: 1 });
    el("practiceTokenForm").onsubmit = event => {
      event.preventDefault();
      practiceAction({ type: "token", name: el("practiceTokenName").value });
      el("practiceTokenName").value = "";
    };
    practiceWired = true;
  }
  renderPractice();
}

function practiceAction(action) {
  if (!practiceSession) return;
  if (action.type === "undo") {
    if (practiceSession.history.length) practiceSession.game = practiceSession.history.pop();
  } else {
    let next;
    if (action.type === "reset") {
      if (!window.confirm("Reset this practice game using the current saved deck?")) return;
      const deck = deckById(state.deckId);
      if (!deck) return;
      next = Goldfish.create(deck);
    } else next = Goldfish.act(practiceSession.game, action);
    if (next === practiceSession.game) return;
    practiceSession.history.push(practiceSession.game);
    if (practiceSession.history.length > 50) practiceSession.history.shift();
    practiceSession.game = next;
  }
  if (!practiceSession.game.zones[practiceZone].includes(practiceSelected)) practiceSelected = null;
  renderPractice();
}

function renderPractice() {
  const game = practiceSession.game;
  el("goldfishTitle").textContent = `${game.name} · Practice`;
  el("goldfishSummary").textContent = game.message;
  el("practiceLife").textContent = game.life;
  el("practiceTurn").textContent = `Turn ${game.turn}`;
  el("practiceUndo").disabled = !practiceSession.history.length;
  el("practiceDraw").disabled = !game.zones.library.length;
  el("practiceZones").innerHTML = Goldfish.zones.map(zone =>
    `<button class="btn${zone === practiceZone ? " primary" : ""}" data-zone="${zone}" aria-pressed="${zone === practiceZone}">${zone === "command" ? "Command zone" : zone[0].toUpperCase() + zone.slice(1)} · ${game.zones[zone].length}</button>`).join("");
  const visible = practiceZone === "library" ? [] : game.zones[practiceZone];
  el("practiceZoneHint").textContent = practiceZone === "library"
    ? `${game.zones.library.length} cards face down. Use Draw to take the top card.`
    : visible.length ? "Select a card to move it or adjust it." : "This zone is empty.";
  el("goldfishHand").innerHTML = visible.map(id => {
    const item = game.cards[id];
    const art = imageUrl(item.card, item.face);
    const name = item.card.card_faces?.[item.face]?.name || item.card.name || "Card";
    return `<button type="button" class="practice-card${item.tapped ? " tapped" : ""}${id === practiceSelected ? " selected" : ""}" data-card="${id}" aria-pressed="${id === practiceSelected}">
      <span class="thumb">${art ? `<img src="/img?u=${encodeURIComponent(art)}" alt="" loading="lazy">` : `<span>${escapeHtml(name)}</span>`}</span>
      <span>${escapeHtml(name)}</span><small>${item.tapped ? "Tapped · " : ""}${item.counters} counters${item.proxy ? " · Proxy" : ""}${item.token ? " · Token" : ""}</small></button>`;
  }).join("");
  const selected = game.cards[practiceSelected];
  el("practiceCardActions").hidden = !selected;
  if (selected) {
    el("practiceSelectedName").textContent = selected.card.name || "Selected card";
    el("practiceTap").disabled = practiceZone !== "battlefield";
    el("practiceTap").textContent = selected.tapped ? "Untap" : "Tap";
    el("practiceFlip").hidden = !(selected.card.card_faces?.length > 1);
    el("practiceRemoveToken").hidden = !selected.token;
    el("practiceCounterDown").disabled = selected.counters === 0;
  }
}
