/* A fresh, manual tabletop for each opening. Nothing is persisted. */
let practiceSession = null;
let practiceSelected = new Set();
let practiceZone = null;
let practiceWired = false;
let practiceDrag = null;
let practiceTokenRequest = 0;
let practiceTokenResults = [];
let practiceTokenPage = 1;
let practiceTokenQuery = "";
let practiceTokenPosition = null;

function startPractice(deck) {
  practiceCloseContext();
  practiceCloseTokens();
  practiceSession = { game: Goldfish.create(deck), history: [] };
  practiceSelected.clear();
  practiceZone = null;
  el("practiceSearch").value = "";
  el("practiceCounterName").value = "";
  el("practiceTokenName").value = "";
  el("practiceDestination").value = "battlefield";
  el("practicePreview").innerHTML = '<p class="sub">Hover a card to inspect it.</p>';
  if (!practiceWired) {
    el("practiceControls").addEventListener("click", event => {
      const button = event.target.closest("[data-practice]");
      if (button) practiceAction({ type: button.dataset.practice });
    });
    el("practiceZones").addEventListener("click", event => {
      const button = event.target.closest("[data-zone]");
      if (!button) return;
      practiceCloseTokens();
      practiceZone = practiceZone === button.dataset.zone ? null : button.dataset.zone;
      el("practiceSearch").value = "";
      renderPracticeBrowser();
    });
    el("practiceBrowserClose").onclick = () => { practiceZone = null; renderPracticeBrowser(); };
    el("practiceSearch").oninput = renderPracticeBrowser;
    el("practiceCardActions").addEventListener("click", event => {
      practiceHandleCardAction(event, el("practiceCardActions"));
    });
    el("practiceLifeDown").onclick = () => practiceAction({ type: "life", delta: -1 });
    el("practiceLifeUp").onclick = () => practiceAction({ type: "life", delta: 1 });
    el("practiceTokenForm").onsubmit = event => {
      event.preventDefault();
      practiceOpenTokens();
    };
    el("practiceCustomToken").onclick = () => {
      practiceAction({ type: "token", name: el("practiceTokenName").value });
      el("practiceTokenName").value = "";
    };
    el("practiceTokenClose").onclick = practiceCloseTokens;
    el("practiceTokenSearchForm").onsubmit = event => {
      event.preventDefault(); practiceSearchTokens(1);
    };
    el("practiceTokenPrev").onclick = () => practiceSearchTokens(practiceTokenPage - 1);
    el("practiceTokenNext").onclick = () => practiceSearchTokens(practiceTokenPage + 1);
    el("practiceTokenResults").onclick = event => {
      const button = event.target.closest("[data-token-index]");
      if (!button) return;
      const card = practiceTokenResults[Number(button.dataset.tokenIndex)];
      if (!card) return;
      practiceAction({ type: "token", card, ...practiceTokenPosition });
      practiceCloseTokens();
    };
    const dialog = el("goldfishDialog");
    dialog.addEventListener("contextmenu", event => {
      const node = event.target.closest("[data-card]");
      if (node) {
        event.preventDefault(); practiceOpenContext(node, event.clientX, event.clientY);
      } else if (event.target.closest("#practiceBattlefield")) {
        event.preventDefault(); practiceOpenFieldContext(event.clientX, event.clientY);
      }
    });
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest("#practiceContextMenu")) practiceCloseContext();
    }, true);
    window.addEventListener("resize", () => practiceCloseContext());
    dialog.addEventListener("scroll", event => {
      if (!event.target.closest("#practiceContextMenu")) practiceCloseContext();
    }, true);
    dialog.addEventListener("pointerdown", practicePointerDown);
    document.addEventListener("pointermove", practicePointerMove);
    document.addEventListener("pointerup", practicePointerUp);
    document.addEventListener("pointercancel", practiceCancelDrag);
    window.addEventListener("blur", practiceCancelDrag);
    dialog.addEventListener("dblclick", event => {
      const node = event.target.closest("[data-card]");
      if (!node) return;
      const id = node.dataset.card;
      practiceAction(practiceSession.game.zones.battlefield.includes(id)
        ? { type: "tap", id } : { type: "move", id, zone: "battlefield" });
    });
    dialog.addEventListener("mouseover", event => {
      const node = event.target.closest("[data-card]");
      if (node) practicePreview(node.dataset.card);
    });
    dialog.addEventListener("focusin", event => {
      const node = event.target.closest("[data-card]");
      if (node) practicePreview(node.dataset.card);
    });
    dialog.addEventListener("click", event => {
      // Pointer selection is handled on pointerup; keyboard clicks have detail 0.
      const node = event.target.closest("[data-card]");
      if (node && event.detail === 0) {
        practiceSelected = new Set([node.dataset.card]);
        practiceUpdateSelection();
      }
    });
    document.addEventListener("keydown", event => {
      if (!practiceSession || dialog.hidden || event.defaultPrevented || practiceDrag ||
          event.target.closest("input, select, textarea, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault(); practiceAction({ type: "undo" }); return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const actions = { d: { type: "draw" }, n: { type: "turn" } };
      const selected = { t: { type: "tap" }, f: { type: "flip" },
        g: { type: "move", zone: "graveyard" }, h: { type: "move", zone: "hand" } };
      if (actions[key]) { event.preventDefault(); practiceAction(actions[key]); }
      if (selected[key]) { event.preventDefault(); practiceForSelection(selected[key]); }
    });
    practiceWired = true;
  }
  renderPractice();
  el("practiceFieldScroll").scrollTo(0, 0);
}

function stopPractice() {
  practiceCloseTokens();
  practiceCloseContext();
  practiceCancelDrag();
  practiceSession = null;
  practiceSelected.clear();
}

function practiceEscape() {
  if (el("practiceContextMenu")) { practiceCloseContext(true); return true; }
  if (!el("practiceTokenPicker").hidden) { practiceCloseTokens(); return true; }
  if (practiceDrag) { practiceCancelDrag(); return true; }
  if (practiceZone) { practiceZone = null; renderPracticeBrowser(); return true; }
  return false;
}

function practiceForSelection(action) {
  practiceAction({ type: "batch", actions: [...practiceSelected].map(id => ({ ...action, id })) });
}

function practiceAction(action) {
  if (!practiceSession) return;
  practiceCloseContext();
  if (action.type === "undo") {
    if (practiceSession.history.length) practiceSession.game = practiceSession.history.pop();
  } else {
    let next;
    if (action.type === "reset") {
      if (!window.confirm("Start a fresh practice game?")) return;
      const deck = deckById(state.deckId);
      if (!deck) return;
      practiceCloseTokens();
      next = Goldfish.create(deck);
      practiceSelected.clear();
      practiceZone = null;
    } else next = Goldfish.act(practiceSession.game, action);
    if (next === practiceSession.game) return;
    practiceSession.history.push(practiceSession.game);
    if (practiceSession.history.length > 50) practiceSession.history.shift();
    practiceSession.game = next;
  }
  practiceSelected = new Set([...practiceSelected].filter(id => practiceSession.game.cards[id]));
  renderPractice();
}

function practiceCard(id, field = false) {
  const item = practiceSession.game.cards[id];
  const name = item.faceDown ? "Face-down card" : item.card.card_faces?.[item.face]?.name || item.card.name || "Card";
  const art = item.faceDown ? null : imageUrl(item.card, item.face);
  const counters = [item.counters ? `${item.counters} counters` : "",
    ...Object.entries(item.namedCounters || {}).filter(([, n]) => n).map(([label, n]) => `${label}: ${n}`)].filter(Boolean).join(" · ");
  return `<button type="button" class="practice-card${item.tapped ? " tapped" : ""}${practiceSelected.has(id) ? " selected" : ""}" data-card="${id}" aria-label="${escapeHtml(name)}${item.tapped ? ", tapped" : ""}" aria-pressed="${practiceSelected.has(id)}" ${field ? `style="left:${item.x || 0}px;top:${item.y || 0}px"` : ""}>
    <span class="practice-card-art${item.faceDown ? " face-down" : ""}">${art ? `<img draggable="false" src="/img?u=${encodeURIComponent(art)}" alt="${escapeHtml(name)}">` : `<span>${escapeHtml(name)}</span>`}</span>
    ${counters ? `<span class="practice-counter-badge">${escapeHtml(counters)}</span>` : ""}
    ${item.token ? '<span class="practice-token-badge">Token</span>' : ""}</button>`;
}

function renderPractice() {
  const game = practiceSession.game;
  el("goldfishTitle").textContent = `${game.name} · Practice`;
  el("goldfishSummary").textContent = game.message;
  el("practiceLife").textContent = game.life;
  el("practiceTurn").textContent = `Turn ${game.turn}`;
  el("practiceUndo").disabled = !practiceSession.history.length;
  el("practiceDraw").disabled = !game.zones.library.length;
  el("practiceHandCount").textContent = `· ${game.zones.hand.length}`;
  el("goldfishHand").innerHTML = game.zones.hand.map(id => practiceCard(id)).join("") || '<p class="sub">Drag cards here to return them to your hand.</p>';
  const field = el("practiceBattlefield");
  field.innerHTML = '<span class="practice-field-label">BATTLEFIELD <small>Place your cards anywhere</small></span>' + game.zones.battlefield.map(id => practiceCard(id, true)).join("");
  field.style.width = `${Math.max(500, ...game.zones.battlefield.map(id => (game.cards[id].x || 0) + 190))}px`;
  field.style.height = `${Math.max(240, ...game.zones.battlefield.map(id => (game.cards[id].y || 0) + 210))}px`;
  el("practiceZones").innerHTML = ["library", "command", "graveyard", "exile"].map(zone => {
    const ids = game.zones[zone];
    const top = zone === "library" ? null : ids.at(-1);
    return `<section class="practice-zone" data-drop-zone="${zone}"><button class="practice-zone-heading" data-zone="${zone}">${zone === "command" ? "Command" : zone[0].toUpperCase() + zone.slice(1)} <b>${ids.length}</b></button>
      ${zone === "library" ? `<button class="practice-card practice-library" data-zone="library" aria-label="Search library"><span class="practice-card-art face-down">Search library</span></button>` : top ? practiceCard(top) : '<span class="practice-empty-zone">Drop here</span>'}</section>`;
  }).join("");
  renderPracticeBrowser();
  practiceUpdateSelection();
  if (practiceSelected.size) practicePreview([...practiceSelected].at(-1));
  else el("practicePreview").innerHTML = '<p class="sub">Hover a card to inspect it.</p>';
}

function renderPracticeBrowser() {
  el("practiceZoneBrowser").hidden = !practiceZone;
  if (!practiceZone) return;
  el("practiceBrowserTitle").textContent = `${practiceZone[0].toUpperCase() + practiceZone.slice(1)} · ${practiceSession.game.zones[practiceZone].length}`;
  const query = el("practiceSearch").value.toLowerCase();
  const ids = practiceSession.game.zones[practiceZone].filter(id => (practiceSession.game.cards[id].card.name || "").toLowerCase().includes(query));
  el("practiceBrowserCards").innerHTML = ids.map(id => practiceCard(id)).join("") || '<p class="sub">No cards.</p>';
}

function practiceUpdateSelection() {
  document.querySelectorAll('#goldfishDialog [data-card]').forEach(node => {
    const selected = practiceSelected.has(node.dataset.card);
    node.classList.toggle("selected", selected);
    node.setAttribute("aria-pressed", String(selected));
  });
  const selected = [...practiceSelected].map(id => practiceSession.game.cards[id]).filter(Boolean);
  el("practiceSelectedName").textContent = selected.length === 1 ? selected[0].card.name : `${selected.length} cards selected`;
  el("practiceCardActions").querySelectorAll("button").forEach(button => { button.disabled = !selected.length; });
}

function practicePreview(id) {
  const item = practiceSession?.game.cards[id];
  if (!item) return;
  const art = item.faceDown ? null : imageUrl(item.card, item.face);
  const face = item.card.card_faces?.[item.face] || item.card;
  el("practicePreview").innerHTML = `${art ? `<img src="/img?u=${encodeURIComponent(art)}" alt="">` : ""}<strong>${escapeHtml(item.faceDown ? "Face-down card" : face.name || item.card.name || "Card")}</strong>`;
}

function practicePointerDown(event) {
  if (event.button !== 0 || !practiceSession) return;
  const node = event.target.closest("[data-card]");
  const field = el("practiceBattlefield");
  if (!node && event.target !== field && !event.target.closest(".practice-field-label")) return;
  event.preventDefault();
  const prior = new Set(practiceSelected);
  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  if (node && !practiceSelected.has(node.dataset.card)) {
    if (!additive) practiceSelected.clear();
    practiceSelected.add(node.dataset.card);
  } else if (!node && !additive) practiceSelected.clear();
  practiceUpdateSelection();
  const rect = node?.getBoundingClientRect();
  practiceDrag = { id: node?.dataset.card, x: event.clientX, y: event.clientY,
    offsetX: rect ? event.clientX - rect.left : 0, offsetY: rect ? event.clientY - rect.top : 0,
    prior, additive, moved: false, ghost: null, marquee: null };
}

function practicePointerMove(event) {
  const drag = practiceDrag;
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  if (drag.id) {
    if (!drag.ghost) {
      drag.ghost = document.createElement("div");
      drag.ghost.className = "practice-drag-ghost";
      drag.ghost.innerHTML = practiceCard(drag.id) + `<b>${practiceSelected.size > 1 ? `${practiceSelected.size} cards` : ""}</b>`;
      document.body.append(drag.ghost);
    }
    drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
    drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
    document.querySelectorAll(".practice-drop-active").forEach(n => n.classList.remove("practice-drop-active"));
    document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drop-zone]")?.classList.add("practice-drop-active");
  } else {
    if (!drag.marquee) {
      drag.marquee = document.createElement("div");
      drag.marquee.className = "practice-marquee";
      document.body.append(drag.marquee);
    }
    const left = Math.min(drag.x, event.clientX), top = Math.min(drag.y, event.clientY);
    const right = Math.max(drag.x, event.clientX), bottom = Math.max(drag.y, event.clientY);
    Object.assign(drag.marquee.style, { left: `${left}px`, top: `${top}px`, width: `${right-left}px`, height: `${bottom-top}px` });
    practiceSelected = drag.additive ? new Set(drag.prior) : new Set();
    el("practiceBattlefield").querySelectorAll("[data-card]").forEach(node => {
      const r = node.getBoundingClientRect();
      if (r.right > left && r.left < right && r.bottom > top && r.top < bottom) practiceSelected.add(node.dataset.card);
    });
    practiceUpdateSelection();
  }
}

function practicePointerUp(event) {
  const drag = practiceDrag;
  if (!drag) return;
  if (drag.id && drag.moved) {
    const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drop-zone]");
    if (destination) {
      const zone = destination.dataset.dropZone;
      const rect = el("practiceBattlefield").getBoundingClientRect();
      const game = practiceSession.game;
      const anchor = game.cards[drag.id];
      const anchorOnField = game.zones.battlefield.includes(drag.id);
      const anchorIndex = [...practiceSelected].indexOf(drag.id);
      const actions = [...practiceSelected].map((id, index) => {
        const item = game.cards[id];
        const onField = anchorOnField && game.zones.battlefield.includes(id);
        return { type: "move", id, zone,
          x: event.clientX - rect.left - drag.offsetX + (onField ? (item.x || 0) - (anchor.x || 0) : (index - anchorIndex) * 25),
          y: event.clientY - rect.top - drag.offsetY + (onField ? (item.y || 0) - (anchor.y || 0) : (index - anchorIndex) * 25) };
      });
      const minX = Math.min(0, ...actions.map(a => a.x)), minY = Math.min(0, ...actions.map(a => a.y));
      actions.forEach(a => { a.x -= minX; a.y -= minY; });
      practiceAction({ type: "batch", actions });
    }
  } else if (drag.id && !drag.moved) {
    if (drag.additive && drag.prior.has(drag.id)) practiceSelected.delete(drag.id);
    else if (!drag.additive) practiceSelected = new Set([drag.id]);
    practiceUpdateSelection();
    practicePreview(drag.id);
  }
  practiceCancelDrag();
}

function practiceCancelDrag() {
  practiceDrag?.ghost?.remove();
  practiceDrag?.marquee?.remove();
  practiceDrag = null;
  document.querySelectorAll(".practice-drop-active").forEach(n => n.classList.remove("practice-drop-active"));
}

// Reuse the sidebar controls so both entry points offer identical actions.
function practiceHandleCardAction(event, container) {
  const button = event.target.closest("[data-card-action]");
  if (!button) return;
  const action = { type: button.dataset.cardAction };
  if (action.type === "counter") {
    action.delta = Number(button.dataset.delta);
    action.name = container.querySelector('[id$="CounterName"]').value.trim();
  }
  if (action.type === "move") {
    [action.zone, action.position] = container.querySelector('[id$="Destination"]').value.split(":");
  }
  practiceForSelection(action);
}

function practiceCloseContext(restoreFocus = false) {
  const menu = el("practiceContextMenu");
  if (!menu) return;
  const id = menu.dataset.sourceCard;
  menu.remove();
  if (restoreFocus) el("goldfishDialog").querySelector(`[data-card="${id}"]`)?.focus();
}

function practiceOpenContext(node, x, y) {
  practiceCloseContext();
  practiceCancelDrag();
  const id = node.dataset.card;
  if (!practiceSelected.has(id)) practiceSelected = new Set([id]);
  practiceUpdateSelection();
  practicePreview(id);
  const menu = el("practiceCardActions").cloneNode(true);
  menu.id = "practiceContextMenu";
  menu.className = "practice-context-menu";
  menu.dataset.sourceCard = id;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Card actions");
  menu.querySelectorAll("[id]").forEach(child => { child.id = `context-${child.id}`; });
  menu.querySelector('[id$="Destination"]').value = el("practiceDestination").value;
  menu.addEventListener("click", event => practiceHandleCardAction(event, menu));
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); practiceCloseContext(true);
    }
  });
  el("goldfishDialog").append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  menu.querySelector("select").focus({ preventScroll: true });
}

function practiceOpenFieldContext(x, y) {
  practiceCloseContext();
  practiceCancelDrag();
  const field = el("practiceBattlefield").getBoundingClientRect();
  const position = { x: Math.max(0, x - field.left), y: Math.max(0, y - field.top) };
  const menu = document.createElement("div");
  menu.id = "practiceContextMenu";
  menu.className = "practice-context-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Battlefield actions");
  menu.innerHTML = '<strong>Battlefield</strong><div class="practice-toolbar"><button class="btn" data-field-action="token">Create token…</button><button class="btn" data-field-action="draw">Draw</button><button class="btn" data-field-action="untap">Untap all</button><button class="btn" data-field-action="turn">Next turn</button><button class="btn" data-field-action="shuffle">Shuffle library</button></div>';
  menu.onclick = event => {
    const button = event.target.closest("[data-field-action]");
    if (!button) return;
    if (button.dataset.fieldAction === "token") practiceOpenTokens(position);
    else practiceAction({ type: button.dataset.fieldAction });
  };
  menu.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); practiceCloseContext(); }
  };
  el("goldfishDialog").append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  menu.querySelector("button").focus({ preventScroll: true });
}

function practiceCloseTokens() {
  practiceTokenRequest++;
  practiceTokenResults = [];
  practiceTokenPosition = null;
  el("practiceTokenPicker").hidden = true;
}

function practiceOpenTokens(position = null) {
  practiceCloseContext();
  practiceZone = null;
  renderPracticeBrowser();
  practiceTokenPosition = position;
  el("practiceTokenPicker").hidden = false;
  el("practiceTokenQuery").value = el("practiceTokenName").value;
  el("practiceTokenQuery").focus();
  practiceSearchTokens(1);
}

async function practiceSearchTokens(page) {
  const request = ++practiceTokenRequest;
  const session = practiceSession;
  if (page === 1) practiceTokenQuery = el("practiceTokenQuery").value.trim();
  practiceTokenResults = [];
  el("practiceTokenResults").innerHTML = "";
  el("practiceTokenStatus").textContent = "Searching Scryfall…";
  el("practiceTokenPrev").disabled = true;
  el("practiceTokenNext").disabled = true;
  el("practiceTokenPage").textContent = "";
  try {
    const data = await getJson(`/api/tokens?q=${encodeURIComponent(practiceTokenQuery)}&page=${page}`);
    if (request !== practiceTokenRequest || session !== practiceSession) return;
    practiceTokenResults = data.data || [];
    practiceTokenPage = page;
    el("practiceTokenStatus").textContent = practiceTokenResults.length ? "Click a token to place it on the battlefield. Artwork from Scryfall." : "No tokens found. Try a name like Soldier or Treasure, or use Create custom token in the sidebar.";
    el("practiceTokenResults").innerHTML = practiceTokenResults.map((card, index) => {
      const art = imageUrl(card, 0);
      const stats = card.power != null ? ` · ${card.power}/${card.toughness}` : "";
      return `<button type="button" class="practice-token-result" data-token-index="${index}">${art ? `<img loading="lazy" src="/img?u=${encodeURIComponent(art)}" alt="${escapeHtml(card.name)}">` : ""}<span>${escapeHtml(card.name + stats)}</span><small>${escapeHtml(card.set_name || "")}</small></button>`;
    }).join("");
    el("practiceTokenPage").textContent = `Page ${page}`;
    el("practiceTokenPrev").disabled = page <= 1;
    el("practiceTokenNext").disabled = !data.has_more;
  } catch (error) {
    if (request !== practiceTokenRequest || session !== practiceSession) return;
    el("practiceTokenStatus").textContent = `Token search failed: ${error.message}. Retry Search or create a custom token.`;
  }
}
