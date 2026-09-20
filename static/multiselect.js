/* Collection and deck selection. Bulk writes use the normal ownership checks. */
class CardSelection {
  constructor() { this.clear(); }
  clear() { this.ids = new Set(); this.anchor = null; this.active = false; }
  retain(visible) {
    const allowed = new Set(visible);
    this.ids = new Set([...this.ids].filter(id => allowed.has(id)));
    if (!allowed.has(this.anchor)) this.anchor = null;
  }
  toggle(id, visible, range = false) {
    this.active = true;
    const start = visible.indexOf(this.anchor), end = visible.indexOf(id);
    if (range && start >= 0 && end >= 0) {
      visible.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(key => this.ids.add(key));
    } else {
      if (this.ids.has(id)) this.ids.delete(id); else this.ids.add(id);
      this.anchor = id;
    }
  }
}

const cardSelections = {};
let selectionBusy = false;

function resetCardSelections() {
  Object.values(cardSelections).forEach(scope => {
    scope.selection.clear();
    scope.confirmRemove = false;
    if (!selectionBusy) scope.bar.querySelector(".selection-result").textContent = "";
    syncCardSelection(scope.kind);
  });
}

function initCardSelections() {
  for (const [kind, root] of [["collection", ui.collGrid], ["deck", ui.deckGrid]]) {
    const bar = document.createElement("div");
    bar.className = "selection-bar";
    bar.setAttribute("aria-label", `${kind} selection actions`);
    bar.innerHTML = `<button class="btn" data-select-action="mode" aria-pressed="false">Select cards</button>
      <div class="selection-actions" hidden>
        <span data-selection-count role="status" aria-live="polite"></span>
        <button class="btn quiet" data-select-action="all">Select all shown</button>
        <button class="btn quiet" data-select-action="clear">Clear</button>
        ${kind === "collection" ? `<select class="view-select" data-selection-deck aria-label="Destination deck"></select>
          <select class="view-select" data-selection-zone aria-label="Destination zone"><option value="main">Main deck</option><option value="maybeboard">Maybeboard</option></select>
          <button class="btn" data-select-action="add">Add one each</button>` : `
          <button class="btn" data-select-action="main">Move to main deck</button>
          <button class="btn" data-select-action="maybeboard">Move to maybeboard</button>
          <button class="btn danger" data-select-action="remove">Remove from deck</button>`}
        <button class="btn" data-select-action="export">Copy selected list</button>
        <span class="selection-help">Ctrl/⌘-click toggles cards. Shift-click selects a range. Escape exits selection.</span>
      </div>
      <p class="selection-result" role="status" aria-live="polite"></p>`;
    root.before(bar);
    const scope = { kind, root, bar, selection: new CardSelection(), confirmRemove: false };
    cardSelections[kind] = scope;
    bar.addEventListener("click", event => {
      const button = event.target.closest("[data-select-action]");
      if (button && !selectionBusy) selectionAction(scope, button.dataset.selectAction);
    });
    root.addEventListener("click", event => {
      const tile = event.target.closest(".coll-card, .stack-card");
      if (!tile) return;
      const checkbox = event.target.closest(".card-select");
      if (!checkbox && event.target.closest("button, .loc.deck, .steppers")) return;
      if (!checkbox && !scope.selection.active && !event.ctrlKey && !event.metaKey && !event.shiftKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (selectionBusy) return;
      scope.selection.toggle(tile.dataset.id, selectionTiles(scope).map(node => node.dataset.id), event.shiftKey);
      scope.confirmRemove = false;
      hideCardPreview();
      syncCardSelection(kind);
    }, true);
    root.addEventListener("keydown", event => {
      const tile = event.target.closest(".coll-card, .stack-card");
      if (!tile || event.target.closest("button")) return;
      if (event.key === " " || (event.key === "Enter" && scope.selection.active)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selectionBusy) return;
        scope.selection.toggle(tile.dataset.id, selectionTiles(scope).map(node => node.dataset.id), event.shiftKey);
        scope.confirmRemove = false;
        syncCardSelection(kind);
      } else if (event.key === "Enter" && kind === "deck") {
        event.preventDefault();
        openDeckDetail(state.deckId, tile.dataset.id);
      }
    }, true);
    syncCardSelection(kind);
  }
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented || selectionBusy || event.target.closest("input, textarea, select")) return;
    if (!ui.cardDetailDialog.hidden || !ui.deckExportDialog.hidden || !ui.goldfishDialog.hidden) return;
    resetCardSelections();
  });
}

function selectionTiles(scope) {
  return [...scope.root.querySelectorAll(".coll-card, .stack-card")];
}

function syncCardSelection(kind) {
  const scope = cardSelections[kind];
  if (!scope) return;
  const { selection, bar, root } = scope;
  const tiles = selectionTiles(scope);
  selection.retain(tiles.map(node => node.dataset.id));
  root.classList.toggle("selecting-cards", selection.active);
  tiles.forEach(tile => {
    let button = tile.querySelector(".card-select");
    if (!button) {
      button = document.createElement("button");
      button.className = "card-select";
      button.type = "button";
      tile.prepend(button);
    }
    const selected = selection.ids.has(tile.dataset.id);
    const name = tile.querySelector("img")?.alt || tile.dataset.id;
    button.setAttribute("aria-label", `Select ${name}`);
    button.setAttribute("aria-pressed", String(selected));
    button.textContent = selected ? "✓" : "+";
    button.disabled = selectionBusy;
    tile.classList.toggle("card-selected", selected);
    if (kind === "deck") tile.tabIndex = 0;
  });
  const mode = bar.querySelector('[data-select-action="mode"]');
  mode.textContent = selection.active ? "Done selecting" : "Select cards";
  mode.setAttribute("aria-pressed", String(selection.active));
  bar.querySelector(".selection-actions").hidden = !selection.active;
  bar.querySelector("[data-selection-count]").textContent = `${selection.ids.size} selected`;
  const deckSelect = bar.querySelector("[data-selection-deck]");
  if (deckSelect) {
    const previous = deckSelect.value;
    const decks = state.library.decks || [];
    // Avoid replacing a focused dropdown on each selection change.
    const options = decks.map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join("") || '<option value="">Create a deck first</option>';
    if (scope.deckOptions !== options) {
      deckSelect.innerHTML = options;
      if (decks.some(deck => deck.id === previous)) deckSelect.value = previous;
      scope.deckOptions = options;
    }
  }
  bar.querySelectorAll("button, select").forEach(control => {
    const action = control.dataset.selectAction;
    control.disabled = selectionBusy ||
      (["add", "main", "maybeboard", "remove", "export"].includes(action) && !selection.ids.size) ||
      (action === "add" && !deckSelect.value);
  });
  const remove = bar.querySelector('[data-select-action="remove"]');
  if (remove) remove.textContent = scope.confirmRemove ? `Confirm remove ${selection.ids.size} selected rows` : "Remove from deck";
}

function selectionAction(scope, action) {
  const { selection, kind, bar } = scope;
  if (action !== "remove") {
    if (scope.confirmRemove) bar.querySelector(".selection-result").textContent = "";
    scope.confirmRemove = false;
  }
  if (action === "mode") {
    if (selection.active) selection.clear(); else selection.active = true;
  } else if (action === "all") {
    selection.ids = new Set(selectionTiles(scope).map(tile => tile.dataset.id));
  } else if (action === "clear") {
    selection.ids.clear(); selection.anchor = null;
  } else if (action === "export") {
    const rows = kind === "collection"
      ? state.library.entries.filter(entry => selection.ids.has(entry.id)).map(entry => `${entry.quantity} ${entry.name}`)
      : (deckById(state.deckId)?.cards || []).filter(line => selection.ids.has(line.card_id)).map(line => `${line.quantity} ${lineName(line)}`);
    openListExport("Selected cards", rows.join("\n") + "\n", "Selected printings with their full quantities.");
  } else if (action === "remove" && !scope.confirmRemove) {
    scope.confirmRemove = true;
    bar.querySelector(".selection-result").textContent = "Remove all copies of the selected rows from this deck? Your collection will keep those copies.";
  } else {
    runSelectionBatch(scope, action);
    return;
  }
  syncCardSelection(kind);
}

async function runSelectionBatch(scope, action) {
  if (selectionBusy || !scope.selection.ids.size) return;
  const ids = [...scope.selection.ids];
  const deckId = scope.kind === "deck" ? state.deckId : scope.bar.querySelector("[data-selection-deck]").value;
  const zone = action === "add" ? scope.bar.querySelector("[data-selection-zone]").value : action;
  const url = action === "add" ? "/api/decks/add" : action === "remove" ? "/api/decks/remove" : "/api/decks/move";
  const result = scope.bar.querySelector(".selection-result");
  const destination = deckName(deckId);
  // Capture the destination before any awaits: navigation must never redirect a batch.
  selectionBusy = true;
  scope.confirmRemove = false;
  Object.keys(cardSelections).forEach(syncCardSelection);
  let completed = 0;
  try {
    for (const id of ids) {
      result.textContent = `Updating ${destination}: ${completed} of ${ids.length} completed…`;
      const data = await getJson(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck_id: deckId, card_id: id, quantity: 1, zone, all: action === "remove" }),
      });
      scope.selection.ids.delete(id);
      completed++;
      applyPatch(data);
    }
    result.textContent = `${completed} selected printing${completed === 1 ? "" : "s"} updated in ${destination}.`;
    setStatus(result.textContent);
  } catch (error) {
    result.textContent = `${completed} of ${ids.length} completed in ${destination}. Stopped: ${error.message} Remaining cards were not retried; refresh before retrying if the connection was lost.`;
    setStatus(result.textContent, true);
  } finally {
    selectionBusy = false;
    Object.keys(cardSelections).forEach(syncCardSelection);
  }
}
