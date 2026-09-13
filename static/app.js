/* MTG Card Viewer - front end.
   Talks only to the local Flask app, which proxies Scryfall and caches art. */

const FORMATS = ["standard", "pioneer", "modern", "legacy",
                 "vintage", "commander", "pauper", "brawl"];

const RARITY = {
  common: "#cfd6cb", uncommon: "#a9bcc6", rare: "#d4b06a",
  mythic: "#e08849", special: "#c08fd0", bonus: "#c08fd0",
};

// mana symbol -> [disc colour, glyph colour]
const MANA = {
  W: ["#f3ead0", "#2b2a22"], U: ["#9dcbe8", "#11232d"], B: ["#6b6575", "#efebee"],
  R: ["#e8907c", "#321511"], G: ["#86c087", "#112713"], C: ["#bcb5a7", "#25221c"],
  S: ["#ced7dd", "#21272b"], P: ["#a79fae", "#1d1a21"], T: ["#cfc8b8", "#23201a"],
};
const GENERIC = ["#b6afa1", "#222018"];

// Long enough that typing a whole name is one request, not one per letter -
// Scryfall asks for 50-100ms between calls and we would rather stay well clear.
const SUGGEST_DELAY = 500;
const RECENT_MAX = 12;
const RECENT_KEY = "mtg.recent";

const el = (id) => document.getElementById(id);
const ui = {
  search: el("search"), suggestions: el("suggestions"),
  randomBtn: el("randomBtn"), toast: el("toast"), navCard: el("navCard"),
  brandBtn: el("brandBtn"),
  recent: el("recent"), recentEmpty: el("recentEmpty"),
  art: el("cardArt"), artPlaceholder: el("artPlaceholder"), flipBtn: el("flipBtn"),
  name: el("cardName"), mana: el("manaCost"), type: el("typeLine"), pt: el("pt"),
  rules: el("rules"), rarityDot: el("rarityDot"), setLine: el("setLine"),
  artist: el("artistLine"), priceChips: el("priceChips"), legalChips: el("legalChips"),
  printings: el("printings"), scryfallBtn: el("scryfallBtn"),
  addBtn: el("addBtn"), removeBtn: el("removeBtn"), ownedLabel: el("ownedLabel"),
  viewCollectionBtn: el("viewCollectionBtn"), collCount: el("collCount"),
  openFolderBtn: el("openFolderBtn"),
  cardPanel: el("cardPanel"), collectionPanel: el("collectionPanel"),
  collGrid: el("collGrid"), collEmpty: el("collEmpty"), collSummary: el("collSummary"),
  collectionFilter: el("collectionFilter"),
  collectionSort: el("collectionSort"), collectionGridBtn: el("collectionGridBtn"),
  collectionListBtn: el("collectionListBtn"),
  deckList: el("deckList"), deckListEmpty: el("deckListEmpty"), newDeckBtn: el("newDeckBtn"),
  deckPanel: el("deckPanel"), deckName: el("deckName"), deckSummary: el("deckSummary"),
  deckGrid: el("deckGrid"), deckEmpty: el("deckEmpty"), deckFilter: el("deckFilter"),
  deckStats: el("deckStats"),
  availList: el("availList"), availEmpty: el("availEmpty"),
  deleteDeckBtn: el("deleteDeckBtn"),
  deckLegality: el("deckLegality"), deckProblems: el("deckProblems"),
  deckPicker: el("deckPicker"), addToDeckBtn: el("addToDeckBtn"),
  importBtn: el("importBtn"), importPanel: el("importPanel"), importText: el("importText"),
  importFile: el("importFile"), importFileBtn: el("importFileBtn"),
  previewBtn: el("previewBtn"), commitBtn: el("commitBtn"), clearImportBtn: el("clearImportBtn"),
  importReport: el("importReport"), reportTitle: el("reportTitle"), reportOk: el("reportOk"),
  reportBad: el("reportBad"), reportProblemHead: el("reportProblemHead"),
  importHint: el("importHint"),
  whoami: el("whoami"), whoName: el("whoName"), logoutBtn: el("logoutBtn"),
};

const state = {
  card: null,
  face: 0,
  printings: [],
  recent: [],
  suggestions: [],
  active: -1,
  suggestTimer: null,
  suggestSeq: 0,
  cardSeq: 0,
  loadSeq: 0,          // owns the top-bar loading indicator
  library: { entries: [], decks: [], summary: {} },  // loaded once, then patched
  entryById: new Map(),
  deckId: null,        // deck currently open in the builder
  pickerDeck: null,    // "add to deck" choice on the card view
  deleteTimer: null,
  importToken: null,   // ties a previewed import to its commit
  problems: new Map(), // card id -> Commander rule breaks in the open deck
  collectionView: (() => {
    try { return localStorage.getItem("mtg.collection-view") || "grid"; }
    catch { return "grid"; }
  })(),
};

/* ------------------------------------------------------------- helpers */

const escapeHtml = (text) => (text || "").replace(/[&<>"]/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function isDoubleFaced(card) {
  const faces = card.card_faces || [];
  return faces.length > 1 && faces.every((f) => f.image_uris);
}

function faceOf(card, index) {
  const faces = card.card_faces || [];
  return faces.length ? faces[index] : card;
}

function imageUrl(card, index) {
  const source = isDoubleFaced(card) ? faceOf(card, index) : card;
  const uris = source.image_uris || card.image_uris || {};
  return uris.normal || uris.large || uris.png || "";
}

function pipHtml(symbol, small) {
  const cls = "pip" + (small ? " sm" : "");
  const parts = symbol.split("/");
  if (parts.length === 2) {
    const [a, b] = parts.map((p) => MANA[p.toUpperCase()] || GENERIC);
    return `<span class="${cls} hybrid" style="--a:${a[0]};--b:${b[0]}">` +
           `<i style="color:${a[1]}">${escapeHtml(parts[0].toUpperCase())}</i>` +
           `<i style="color:${b[1]}">${escapeHtml(parts[1].toUpperCase())}</i></span>`;
  }
  const [disc, ink] = MANA[symbol.toUpperCase()] || GENERIC;
  return `<span class="${cls}" style="background:${disc};color:${ink}">` +
         `${escapeHtml(symbol.toUpperCase())}</span>`;
}

const manaHtml = (cost, small) =>
  (cost || "").replace(/\{(.*?)\}/g, (_m, sym) => pipHtml(sym, small));

/** Escape first, then turn {T}/{W} tokens into inline pips. */
const withInlinePips = (text) =>
  escapeHtml(text).replace(/\{(.*?)\}/g, (_m, sym) => pipHtml(sym, true));

let toastTimer = null;

/** Transient message, bottom right.  Errors linger; confirmations do not. */
function setStatus(message, isError) {
  if (!message) return;
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", Boolean(isError));
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"),
    isError ? 6500 : 3000);
}

/** A hairline under the topbar, rather than words that push the layout about. */
function setBusy(busy) {
  document.body.classList.toggle("busy", busy);
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    // The session went away (expired, or the server restarted with a new key).
    window.location = "/login?next=" + encodeURIComponent(location.pathname);
    throw new Error("Signed out.");
  }
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.suggestions = payload.suggestions || [];
    throw error;
  }
  return payload;
}

/** Show who is signed in; on a single-user desktop launch there is nobody. */
async function loadIdentity() {
  try {
    const me = await getJson("/api/me");
    const shared = me.user && me.user !== "local";
    ui.whoami.hidden = !shared;
    ui.openFolderBtn.hidden = Boolean(shared);   // the folder is on the server
    if (shared) ui.whoName.textContent = me.user;
  } catch { /* the 401 path has already redirected */ }
}

async function signOut() {
  try {
    await getJson("/logout", { method: "POST" });
  } catch { /* going to the login page regardless */ }
  window.location = "/login";
}

/* ------------------------------------------------------------ autofill */

function hideSuggestions() {
  ui.suggestions.hidden = true;
  ui.suggestions.innerHTML = "";
  state.suggestions = [];
  state.active = -1;
}

function showSuggestions(names) {
  if (!names.length) return hideSuggestions();
  state.suggestions = names;
  state.active = -1;
  ui.suggestions.innerHTML = names
    .map((name) => `<li>${escapeHtml(name)}</li>`).join("");
  [...ui.suggestions.children].forEach((item, index) => {
    item.addEventListener("mouseenter", () => highlight(index));
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();          // keep focus in the input
      accept(index);
    });
  });
  ui.suggestions.hidden = false;
}

function highlight(index) {
  state.active = index;
  [...ui.suggestions.children].forEach((item, i) =>
    item.classList.toggle("active", i === index));
}

function move(step) {
  if (!state.suggestions.length) return;
  const count = state.suggestions.length;
  const next = state.active === -1
    ? (step > 0 ? 0 : count - 1)
    : (state.active + step + count) % count;
  highlight(next);
  ui.suggestions.children[next].scrollIntoView({ block: "nearest" });
}

function accept(index) {
  ui.search.value = state.suggestions[index];
  hideSuggestions();
  search();
}

function scheduleSuggest() {
  clearTimeout(state.suggestTimer);
  const query = ui.search.value.trim();
  if (query.length < 2) return hideSuggestions();
  state.suggestTimer = setTimeout(async () => {
    const seq = ++state.suggestSeq;
    try {
      const names = await getJson(`/api/autocomplete?q=${encodeURIComponent(query)}`);
      // Ignore a reply the user has already typed past.
      if (seq === state.suggestSeq && ui.search.value.trim() === query) {
        showSuggestions(names);
      }
    } catch { /* suggestions are a convenience; stay quiet */ }
  }, SUGGEST_DELAY);
}

/* -------------------------------------------------------------- render */

function renderRules(card) {
  const faces = card.card_faces || [];
  let blocks;
  if (faces.length && isDoubleFaced(card)) blocks = [faceOf(card, state.face)];
  else if (faces.length) blocks = faces;        // split / adventure: one image, two halves
  else blocks = [card];

  const html = blocks.map((block, index) => {
    const parts = [];
    if (index) parts.push('<div class="divider"></div>');
    if (blocks.length > 1) {
      parts.push(`<p class="face-name">${escapeHtml(block.name)} ${manaHtml(block.mana_cost, true)}</p>`);
      parts.push(`<p class="face-type">${escapeHtml(block.type_line || "")}</p>`);
    }
    (block.oracle_text || "").split("\n").filter(Boolean).forEach((line) =>
      parts.push(`<p>${withInlinePips(line)}</p>`));
    if (block.flavor_text) {
      parts.push(`<p class="flavor">${escapeHtml(block.flavor_text)}</p>`);
    }
    return parts.join("");
  }).join("");

  ui.rules.innerHTML = html || '<p class="muted">No rules text.</p>';
}

function renderChips(card) {
  const prices = card.prices || {};
  const money = [
    ["usd", "USD", "$", "legal"], ["usd_foil", "FOIL", "$", "restricted"],
    ["eur", "EUR", "€", "not_legal"], ["tix", "MTGO", "", "not_legal"],
  ].filter(([key]) => prices[key])
   .map(([key, label, symbol, tone]) =>
     `<span class="chip ${tone}">${label}<span class="v">${symbol}${escapeHtml(prices[key])}</span></span>`);
  ui.priceChips.innerHTML = money.length
    ? money.join("")
    : '<span class="chip not_legal">No price data</span>';

  const legalities = card.legalities || {};
  ui.legalChips.innerHTML = FORMATS.map((fmt) => {
    const status = legalities[fmt] || "not_legal";
    const label = fmt.charAt(0).toUpperCase() + fmt.slice(1);
    return `<span class="chip ${status}">${label}</span>`;
  }).join("");
}

function renderArt(card) {
  const url = imageUrl(card, state.face);
  ui.art.classList.remove("loaded");
  ui.artPlaceholder.textContent = url ? "Loading art…" : "No image available";
  ui.artPlaceholder.style.display = "grid";
  if (!url) { ui.art.removeAttribute("src"); return; }
  ui.art.onload = () => {
    ui.art.classList.add("loaded");
    ui.artPlaceholder.style.display = "none";
  };
  ui.art.onerror = () => { ui.artPlaceholder.textContent = "Could not load art"; };
  ui.art.src = `/img?u=${encodeURIComponent(url)}`;
}

function renderCard(card) {
  const face = faceOf(card, state.face);
  const shown = isDoubleFaced(card) ? face : card;

  ui.name.textContent = shown.name || "";
  ui.mana.innerHTML = manaHtml(shown.mana_cost, false);
  ui.type.textContent = shown.type_line || "";

  if (shown.power !== undefined && shown.power !== null) {
    ui.pt.textContent = `${shown.power} / ${shown.toughness}`;
  } else if (shown.loyalty) {
    ui.pt.textContent = `[${shown.loyalty}]`;
  } else {
    ui.pt.textContent = "";
  }

  renderRules(card);
  renderChips(card);
  renderArt(card);

  const rarity = (card.rarity || "common").toLowerCase();
  ui.rarityDot.style.background = RARITY[rarity] || "#8b9c86";
  ui.setLine.textContent =
    `${card.set_name} (${(card.set || "").toUpperCase()}) #${card.collector_number} · ` +
    rarity.charAt(0).toUpperCase() + rarity.slice(1);
  ui.artist.textContent =
    `Illustrated by ${face.artist || card.artist || "Unknown"} · released ${card.released_at || "?"}`;

  ui.flipBtn.hidden = !isDoubleFaced(card);
  ui.scryfallBtn.disabled = !card.scryfall_uri;
  renderOwned();
}

function renderPrintings() {
  const options = state.printings.map((item, index) => {
    const year = (item.released_at || "").slice(0, 4);
    const rarity = (item.rarity || "").replace(/^./, (c) => c.toUpperCase());
    const label = `${year}  ${(item.set || "").toUpperCase()} #${item.collector_number}  ${rarity}`;
    return `<option value="${index}">${escapeHtml(label)}</option>`;
  }).join("");
  ui.printings.innerHTML = options;
  ui.printings.disabled = state.printings.length < 2;
  const current = state.printings.findIndex((item) => item.id === state.card.id);
  if (current >= 0) ui.printings.value = String(current);
}

function pushRecent(card) {
  const key = card.oracle_id || card.id;
  state.recent = [card, ...state.recent.filter((c) => (c.oracle_id || c.id) !== key)]
    .slice(0, RECENT_MAX);
  renderRecent();
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  } catch { /* private mode or quota: the list just won't survive a restart */ }
}

function restoreRecent() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (Array.isArray(saved) && saved.length) {
      state.recent = saved.slice(0, RECENT_MAX);
      renderRecent();
    }
  } catch { /* ignore anything unreadable */ }
}

function renderRecent() {
  ui.recentEmpty.hidden = state.recent.length > 0;
  ui.recent.innerHTML = state.recent.map((c, index) => {
    const color = RARITY[(c.rarity || "common").toLowerCase()] || "#8b9c86";
    return `<li data-index="${index}"><span class="dot" style="background:${color}"></span>` +
           `<span class="rname">${escapeHtml(c.name)}</span></li>`;
  }).join("");
  [...ui.recent.children].forEach((item) => {
    item.addEventListener("click", () => showCard(state.recent[+item.dataset.index]));
  });
}

/* ------------------------------------------------- collection & decks */

/** Apply the complete snapshot returned when the application first loads. */
function applyLibrary(data) {
  state.library = data;
  state.entryById = new Map(data.entries.map((e) => [e.id, e]));
  applySummary(data.summary);
  renderDeckList();
  renderOwned();
  if (!ui.collectionPanel.hidden) renderCollection();
  if (!ui.deckPanel.hidden) renderDeckPanel();
}

/** Merge the small, server-authoritative response from one mutation. */
function applyPatch(data) {
  const entries = new Map(state.library.entries.map((entry) => [entry.id, entry]));
  (data.removed_entries || []).forEach((id) => entries.delete(id));
  (data.entries || []).forEach((entry) => entries.set(entry.id, entry));
  state.library.entries = [...entries.values()].sort((a, b) =>
    (b.added || "").localeCompare(a.added || "") ||
    (a.name || "").localeCompare(b.name || ""));

  const decks = new Map(state.library.decks.map((deck) => [deck.id, deck]));
  (data.removed_decks || []).forEach((id) => decks.delete(id));
  (data.decks || []).forEach((deck) => decks.set(deck.id, deck));
  state.library.decks = [...decks.values()].sort((a, b) =>
    (a.name || "").localeCompare(b.name || ""));

  state.library.summary = data.summary;
  state.entryById = new Map(state.library.entries.map((entry) => [entry.id, entry]));
  applySummary(data.summary);
  renderDeckList();
  renderOwned();
  if (!ui.collectionPanel.hidden) renderCollection();
  if (!ui.deckPanel.hidden) renderDeckPanel();
}

async function loadLibrary() {
  try {
    applyLibrary(await getJson("/api/library"));
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function mutate(url, body, success) {
  try {
    const data = await getJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    applyPatch(data);
    if (success) setStatus(success(data));
    return data;
  } catch (error) {
    setStatus(error.message, true);
    return null;
  }
}

function applySummary(summary) {
  ui.collCount.textContent = summary.total;
  // The folder lives one click away in the rail; it is noise in the heading.
  const parts = [`${summary.total} card${summary.total === 1 ? "" : "s"}`,
                 `${summary.distinct} unique`];
  if (summary.allocated) parts.push(`${summary.free} free, ${summary.allocated} in decks`);
  if (summary.value) parts.push(`$${summary.value.toFixed(2)}`);
  ui.collSummary.textContent = parts.join(" · ");
  ui.openFolderBtn.title = summary.folder || "";
}

/* ------------------------------------------------------- the card view */

function renderOwned() {
  const entry = state.card ? state.entryById.get(state.card.id) : null;
  const held = entry ? entry.quantity : 0;
  const decks = (state.library.decks || []);

  ui.addBtn.disabled = !state.card;
  ui.addBtn.textContent = held ? "Add another" : "Add to collection";
  ui.removeBtn.hidden = held === 0;

  if (!held) {
    ui.ownedLabel.textContent = "";
  } else {
    const where = entry.locations
      .map((l) => `${l.deck_name} ×${l.quantity}`).join(" · ");
    ui.ownedLabel.textContent =
      `${held} in collection — ${entry.available} free` + (where ? ` · ${where}` : "");
  }

  const canDeck = held > 0 && decks.length > 0;
  ui.deckPicker.hidden = !canDeck;
  ui.addToDeckBtn.hidden = !canDeck;
  if (canDeck) {
    const keep = state.pickerDeck;
    ui.deckPicker.innerHTML = decks
      .map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join("");
    if (keep && decks.some((d) => d.id === keep)) ui.deckPicker.value = keep;
    state.pickerDeck = ui.deckPicker.value;
    ui.addToDeckBtn.disabled = entry.available === 0;
    ui.addToDeckBtn.textContent = entry.available === 0 ? "No free copies" : "Add to deck";
  }
}

const addToCollection = () => state.card && mutate(
  "/api/collection/add", { card: state.card },
  (d) => `Added ${d.entry.name} — you now hold ${d.entry.quantity}.`);

const removeFromCollection = (cardId) => mutate(
  "/api/collection/remove", { id: cardId },
  (d) => (d.entry ? `Removed one copy — ${d.entry.quantity} left.`
                  : "Removed from the collection."));

const addCurrentToDeck = () => state.card && mutate(
  "/api/decks/add", { deck_id: ui.deckPicker.value, card_id: state.card.id },
  () => `Added ${state.card.name} to ${deckName(ui.deckPicker.value)}.`);

/* ------------------------------------------------------ the collection */

function locationChips(entry) {
  const chips = [];
  if (entry.available > 0) {
    chips.push(`<span class="loc free">${entry.available} free</span>`);
  }
  entry.locations.forEach((l) => {
    chips.push(`<span class="loc deck" data-deck="${escapeHtml(l.deck_id)}" ` +
               `title="In ${escapeHtml(l.deck_name)}">${escapeHtml(l.deck_name)} ×${l.quantity}</span>`);
  });
  if (!chips.length) chips.push('<span class="loc none">none free</span>');
  return `<div class="locs">${chips.join("")}</div>`;
}

function thumbHtml(entry, badge, extra) {
  const art = imageUrl(entry.card || {}, 0);
  const src = art ? `/img?u=${encodeURIComponent(art)}` : "";
  return `
    <div class="thumb">
      <img src="${src}" alt="${escapeHtml(entry.name)}" loading="lazy">
      <span class="qty">${badge}</span>
      ${extra || ""}
    </div>
    <figcaption>${escapeHtml(entry.name)}
      <small>${escapeHtml((entry.set || "").toUpperCase())} #${escapeHtml(entry.collector_number || "")}</small>
    </figcaption>`;
}

function collectionSearchText(entry) {
  const card = entry.card || {};
  const faces = card.card_faces || [];
  return [entry.name, card.name, card.type_line, card.oracle_text,
          ...faces.flatMap((face) => [face.name, face.type_line, face.oracle_text])]
    .filter(Boolean).join(" ").toLocaleLowerCase();
}

function renderCollection() {
  const allEntries = state.library.entries || [];
  const terms = ui.collectionFilter.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const entries = allEntries
    .filter((entry) => {
      const text = collectionSearchText(entry);
      return terms.every((term) => text.includes(term)) &&
        (ui.collectionSort.value !== "unused" || (entry.allocated || 0) === 0);
    })
    .sort(collectionComparator(ui.collectionSort.value));
  ui.collGrid.classList.toggle("list-view", state.collectionView === "list");
  ui.collectionGridBtn.classList.toggle("active", state.collectionView === "grid");
  ui.collectionListBtn.classList.toggle("active", state.collectionView === "list");
  ui.collectionGridBtn.setAttribute("aria-pressed", state.collectionView === "grid");
  ui.collectionListBtn.setAttribute("aria-pressed", state.collectionView === "list");
  ui.collEmpty.hidden = entries.length > 0;
  if (!entries.length) {
    const noUnused = !allEntries.some((entry) => (entry.allocated || 0) === 0);
    ui.collEmpty.textContent = allEntries.length
      ? (ui.collectionSort.value === "unused" && noUnused
        ? "Every card is allocated to a deck."
        : "No cards match that name or rules-text search.")
      : "Nothing saved yet — find a card and add it to the collection, or import a list.";
  }
  ui.collGrid.innerHTML = entries.map((entry) => `
    <figure class="coll-card" data-id="${escapeHtml(entry.id)}">
      ${thumbHtml(entry, `×${entry.quantity}`,
        `<button class="drop" data-drop="${escapeHtml(entry.id)}" title="Remove one copy">−</button>`)}
      ${locationChips(entry)}
    </figure>`).join("");
  wireTiles(ui.collGrid, (id) => openCardById(id));
}

function cardValue(entry) {
  return Number.parseFloat((entry.card || {}).prices?.usd) || 0;
}

function collectionComparator(sort) {
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "") ||
    (a.set || "").localeCompare(b.set || "") ||
    (a.collector_number || "").localeCompare(b.collector_number || "");
  if (sort === "newest") return (a, b) => (b.added || "").localeCompare(a.added || "") || byName(a, b);
  if (sort === "quantity") return (a, b) => b.quantity - a.quantity || byName(a, b);
  if (sort === "value") return (a, b) => cardValue(b) - cardValue(a) || byName(a, b);
  if (sort === "set") return (a, b) => (a.set_name || a.set || "").localeCompare(b.set_name || b.set || "") || byName(a, b);
  return byName;
}

function setCollectionView(view) {
  state.collectionView = view;
  try { localStorage.setItem("mtg.collection-view", view); } catch { /* preference is optional */ }
  renderCollection();
}

/** Shared tile behaviour: open the card, drop a copy, or jump to a deck. */
function wireTiles(root, onOpen) {
  root.querySelectorAll(".coll-card").forEach((node) => {
    node.addEventListener("click", (event) => {
      const target = event.target;
      if (target.dataset.drop || target.dataset.deck || target.dataset.step) return;
      onOpen(node.dataset.id);
    });
  });
  root.querySelectorAll(".drop").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFromCollection(node.dataset.drop);
    });
  });
  root.querySelectorAll(".loc.deck").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      openDeck(node.dataset.deck);
    });
  });
}

function openCardById(cardId) {
  const entry = state.entryById.get(cardId);
  if (entry && entry.card) showCard(entry.card);
}

/* ------------------------------------------------------------- decking */

const deckById = (id) => (state.library.decks || []).find((d) => d.id === id);
const deckName = (id) => (deckById(id) || {}).name || "the deck";

function renderDeckList() {
  const decks = state.library.decks || [];
  ui.deckListEmpty.hidden = decks.length > 0;
  ui.deckList.innerHTML = decks.map((deck) => `
    <li data-id="${escapeHtml(deck.id)}" class="${deck.id === state.deckId ? "active" : ""}">
      <span class="dname">${escapeHtml(deck.name)}</span>
      <span class="dcount">${deck.count}</span>
    </li>`).join("");
  [...ui.deckList.children].forEach((item) => {
    item.addEventListener("click", () => openDeck(item.dataset.id));
  });
}

/* Columns are grouped by card type, the way Archidekt lays a deck out. */
const CATEGORIES = [
  { key: "commander", label: "Commander" },
  { key: "creature", label: "Creatures" },
  { key: "planeswalker", label: "Planeswalkers" },
  { key: "instant", label: "Instants" },
  { key: "sorcery", label: "Sorceries" },
  { key: "artifact", label: "Artifacts" },
  { key: "enchantment", label: "Enchantments" },
  { key: "battle", label: "Battles" },
  { key: "land", label: "Lands" },
  { key: "other", label: "Other" },
];

/** A double-faced card is categorised by its front, not by "front // back". */
const frontFace = (card) => ((card.card_faces || [])[0] || card);

function cardCategory(card) {
  const line = (frontFace(card).type_line || card.type_line || "").toLowerCase();
  // Land wins over creature so Dryad Arbor files with the lands, but an
  // artifact creature is a creature first.
  if (line.includes("land")) return "land";
  if (line.includes("creature")) return "creature";
  if (line.includes("planeswalker")) return "planeswalker";
  if (line.includes("battle")) return "battle";
  if (line.includes("instant")) return "instant";
  if (line.includes("sorcery")) return "sorcery";
  if (line.includes("artifact")) return "artifact";
  if (line.includes("enchantment")) return "enchantment";
  return "other";
}

/** Legendary creatures, plus anything that says it can lead a deck. */
function canBeCommander(card) {
  const front = frontFace(card);
  const line = (front.type_line || "").toLowerCase();
  const text = (front.oracle_text || card.oracle_text || "").toLowerCase();
  if (text.includes("can be your commander")) return true;
  return line.includes("legendary") && line.includes("creature");
}

/* ------------------------------------------------ commander legality */

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const PIP_ORDER = ["W", "U", "B", "R", "G"];

/* Scryfall reports Commander legality per card.  "banned" is the ban list;
   "not_legal" is everything outside the format altogether — Un-set cards,
   Alchemy rebalances, Mystery Booster playtest cards. */
const BAD_LEGALITY = {
  banned: "banned in Commander",
  not_legal: "not legal in Commander",
};

/** Rules text from every face, so a two-sided card is read whole. */
function allOracle(card) {
  const faces = card.card_faces || [];
  return [card.oracle_text || "", ...faces.map((f) => f.oracle_text || "")]
    .join("\n").toLowerCase();
}

/**
 * How many copies Commander's singleton rule allows.
 * Basic lands are unlimited, and a few cards buy themselves an exemption in
 * their own rules text ("A deck can have any number of cards named …").
 */
function copyLimit(card) {
  const type = (card.type_line || "").toLowerCase();
  if (type.includes("basic") && type.includes("land")) return Infinity;

  const text = allOracle(card);
  if (text.includes("a deck can have any number of cards named")) return Infinity;
  const capped = text.match(/a deck can have up to (\w+) cards? named/);
  if (capped) return WORD_NUMBERS[capped[1]] || parseInt(capped[1], 10) || 1;
  return 1;
}

const identityLabel = (colors) =>
  (colors.length ? PIP_ORDER.filter((c) => colors.includes(c)).join("/") : "colourless");

/**
 * Every rule break in the deck, as card id -> list of reasons.
 *
 * Singleton is counted by card *name*, so two different printings of one card
 * still collide.  Colour identity only applies once a commander is named.
 */
function deckProblems(deck) {
  const problems = new Map();
  const note = (id, reason) => {
    if (!problems.has(id)) problems.set(id, []);
    problems.get(id).push(reason);
  };

  const byName = new Map();
  deck.cards.forEach((line) => {
    const entry = state.entryById.get(line.card_id);
    if (!entry) return;                       // missing cards flag themselves
    const card = entry.card || {};
    const name = card.name || entry.name || line.card_id;
    const seen = byName.get(name) || { total: 0, ids: [], card };
    seen.total += line.quantity;
    seen.ids.push(line.card_id);
    byName.set(name, seen);
  });

  byName.forEach((seen, name) => {
    const limit = copyLimit(seen.card);
    if (seen.total <= limit) return;
    const allowed = limit === 1 ? "only one copy" : `only ${limit} copies`;
    seen.ids.forEach((id) =>
      note(id, `${seen.total} copies of ${name} — Commander allows ${allowed}`));
  });

  const commander = deck.commander_id ? state.entryById.get(deck.commander_id) : null;
  const identity = commander
    ? new Set((commander.card || {}).color_identity || []) : null;

  deck.cards.forEach((line) => {
    const entry = state.entryById.get(line.card_id);
    if (!entry) return;
    const card = entry.card || {};

    // Format legality holds whether or not a commander has been named.
    const status = (card.legalities || {}).commander;
    if (BAD_LEGALITY[status]) {
      note(line.card_id, `${entry.name} is ${BAD_LEGALITY[status]}`);
    }

    // Colour identity only means something once there is a commander, and the
    // commander can never breach the identity it defines.
    if (!identity || line.card_id === deck.commander_id) return;
    const outside = (card.color_identity || [])
      .filter((colour) => !identity.has(colour));
    if (outside.length) {
      note(line.card_id,
        `${entry.name} is ${identityLabel(outside)} — outside ` +
        `${commander.name}'s ${identityLabel([...identity])} identity`);
    }
  });
  return problems;
}

function renderDeckPanel() {
  const deck = deckById(state.deckId);
  if (!deck) return showCollectionView();

  if (document.activeElement !== ui.deckName) ui.deckName.value = deck.name;
  state.problems = deckProblems(deck);
  renderDeckSummary(deck);
  renderDeckStats(deck);

  const groups = new Map(CATEGORIES.map((c) => [c.key, []]));
  deck.cards.forEach((line) => {
    const entry = state.entryById.get(line.card_id);
    const key = line.card_id === deck.commander_id ? "commander"
      : entry ? cardCategory(entry.card || {}) : "other";
    groups.get(key).push({ line, entry });
  });
  groups.forEach((items) => items.sort((a, b) => {
    const cmc = (x) => ((x.entry && x.entry.card && x.entry.card.cmc) || 0);
    return cmc(a) - cmc(b)
      || ((a.entry && a.entry.name) || "").localeCompare((b.entry && b.entry.name) || "");
  }));

  ui.deckEmpty.hidden = deck.cards.length > 0;
  ui.deckGrid.innerHTML = CATEGORIES
    .filter((category) => groups.get(category.key).length)
    .map((category) => {
      const items = groups.get(category.key);
      const count = items.reduce((sum, item) => sum + item.line.quantity, 0);
      return `
        <div class="type-col">
          <h4><span>${category.label}</span><span class="n">${count}</span></h4>
          <div class="stack">${items.map((item) => stackCardHtml(item, deck)).join("")}</div>
        </div>`;
    }).join("");

  wireDeckCards();
  renderAvailable();
}

function renderDeckSummary(deck) {
  const unique = deck.cards.length;
  const commander = deck.commander_id ? state.entryById.get(deck.commander_id) : null;
  const parts = [`${deck.count} / 100 cards`, `${unique} unique`];
  parts.push(commander ? `led by ${commander.name}` : "no commander set");
  ui.deckSummary.textContent = parts.join(" · ");
  ui.deckSummary.classList.toggle("ok", deck.count === 100 && Boolean(commander));

  const broken = state.problems.size;
  ui.deckLegality.hidden = deck.cards.length === 0;
  ui.deckLegality.className = "legality " + (broken ? "bad" : "ok");
  ui.deckLegality.textContent = broken
    ? `${broken} card${broken === 1 ? "" : "s"} break the rules`
    : "No rule breaks";

  // One line naming the offences, so they need not be hunted card by card.
  const reasons = [...new Set([...state.problems.values()].flat())];
  ui.deckProblems.hidden = reasons.length === 0;
  ui.deckProblems.textContent = reasons.slice(0, 3).join(" · ") +
    (reasons.length > 3 ? ` · +${reasons.length - 3} more` : "");
}

function stackCardHtml({ line, entry }, deck) {
  const id = escapeHtml(line.card_id);
  const isCommander = line.card_id === deck.commander_id;

  if (!entry) {
    return `
      <div class="stack-card missing" data-id="${id}">
        <div class="gone">Not in your collection</div>
        <span class="qty">×${line.quantity}</span>
        ${steppersHtml(line, true)}
      </div>`;
  }

  const art = imageUrl(entry.card || {}, 0);
  const lead = canBeCommander(entry.card || {});
  const broken = state.problems.get(line.card_id) || [];
  const tip = [entry.name, ...broken.map((reason) => "⚠ " + reason)].join("\n");
  return `
    <div class="stack-card${isCommander ? " is-commander" : ""}${broken.length ? " illegal" : ""}"
         data-id="${id}" title="${escapeHtml(tip)}">
      ${broken.length ? '<span class="warn" aria-label="Breaks a deck rule">!</span>' : ""}
      <img src="${art ? `/img?u=${encodeURIComponent(art)}` : ""}"
           alt="${escapeHtml(entry.name)}" loading="lazy">
      ${line.quantity > 1 ? `<span class="qty">×${line.quantity}</span>` : ""}
      ${lead ? `<button class="cmd${isCommander ? " on" : ""}" data-cmd="${id}"
         title="${isCommander ? "Not the commander" : "Make this the commander"}">★</button>` : ""}
      ${steppersHtml(line, false)}
    </div>`;
}

function steppersHtml(line, missing) {
  const entry = state.entryById.get(line.card_id);
  const canAdd = entry && entry.available > 0;
  return `
    <div class="steppers">
      <button data-step="down" data-card="${escapeHtml(line.card_id)}" title="Remove one">−</button>
      <span class="n" data-step="n">${line.quantity}</span>
      <button data-step="up" data-card="${escapeHtml(line.card_id)}" title="${
        canAdd ? "Add one more" : "No free copies left"}" ${
        canAdd && !missing ? "" : "disabled"}>+</button>
    </div>`;
}

function wireDeckCards() {
  ui.deckGrid.querySelectorAll(".stack-card").forEach((node) => {
    node.addEventListener("click", (event) => {
      if (event.target.dataset.step || event.target.dataset.cmd) return;
      openCardById(node.dataset.id);
    });
  });
  ui.deckGrid.querySelectorAll("[data-step]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const { step, card } = node.dataset;
      const url = step === "up" ? "/api/decks/add" : "/api/decks/remove";
      mutate(url, { deck_id: state.deckId, card_id: card });
    });
  });
  ui.deckGrid.querySelectorAll("[data-cmd]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const deck = deckById(state.deckId);
      const next = deck.commander_id === node.dataset.cmd ? null : node.dataset.cmd;
      mutate("/api/decks/commander", { deck_id: state.deckId, card_id: next },
        () => (next ? `${state.entryById.get(next).name} leads the deck.`
                    : "Commander cleared."));
    });
  });
}

function renderAvailable() {
  const filter = ui.deckFilter.value.trim().toLowerCase();
  const free = (state.library.entries || [])
    .filter((e) => e.available > 0)
    .filter((e) => !filter || (e.name || "").toLowerCase().includes(filter))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  ui.availEmpty.hidden = free.length > 0;
  ui.availEmpty.textContent = filter && !free.length
    ? "Nothing free matches that."
    : "Every copy you own is already in a deck.";

  const deck = deckById(state.deckId) || {};
  const commander = deck.commander_id ? state.entryById.get(deck.commander_id) : null;
  const identity = commander ? new Set((commander.card || {}).color_identity || []) : null;

  ui.availList.innerHTML = free.map((entry) => {
    const art = imageUrl(entry.card || {}, 0);
    const src = art ? `/img?u=${encodeURIComponent(art)}` : "";
    // Flag a colour clash here too, so it is visible before the card goes in.
    const outside = identity
      ? ((entry.card || {}).color_identity || []).filter((c) => !identity.has(c)) : [];
    const tip = outside.length
      ? `Outside ${commander.name}'s ${identityLabel([...identity])} identity`
      : "Add to this deck";
    return `
      <li data-id="${escapeHtml(entry.id)}" class="${outside.length ? "off-colour" : ""}"
          title="${escapeHtml(tip)}">
        <img src="${src}" alt="" loading="lazy">
        <span class="an"><span>${escapeHtml(entry.name)}</span>
          <small>${escapeHtml((entry.set || "").toUpperCase())} #${escapeHtml(entry.collector_number || "")}</small>
        </span>
        <span class="free">${entry.available}</span>
      </li>`;
  }).join("");

  [...ui.availList.children].forEach((item) => {
    item.addEventListener("click", () => {
      mutate("/api/decks/add", { deck_id: state.deckId, card_id: item.dataset.id });
    });
  });
}

async function newDeck() {
  const data = await mutate("/api/decks/create", { name: "New deck" },
    () => "Deck created — give it a name.");
  if (!data) return;
  openDeck(data.deck_id);
  ui.deckName.focus();
  ui.deckName.select();
}

function renameDeck() {
  const deck = deckById(state.deckId);
  const name = ui.deckName.value.trim();
  if (!deck || !name || name === deck.name) {
    if (deck) ui.deckName.value = deck.name;   // put an empty edit back
    return;
  }
  mutate("/api/decks/rename", { id: state.deckId, name }, (d) => {
    const renamed = (d.decks || []).find((x) => x.id === state.deckId);
    return `Renamed to ${renamed ? renamed.name : name}.`;
  });
}

/** Delete arms itself first, so one stray click cannot lose a deck. */
function deleteDeck() {
  if (!ui.deleteDeckBtn.classList.contains("armed")) {
    ui.deleteDeckBtn.classList.add("armed");
    ui.deleteDeckBtn.textContent = "Click again to delete";
    clearTimeout(state.deleteTimer);
    state.deleteTimer = setTimeout(disarmDelete, 4000);
    return;
  }
  const name = deckName(state.deckId);
  disarmDelete();
  mutate("/api/decks/delete", { id: state.deckId },
    () => `Deleted ${name} — its cards are free again.`)
    .then((data) => { if (data) showCollectionView(); });
}

function disarmDelete() {
  clearTimeout(state.deleteTimer);
  ui.deleteDeckBtn.classList.remove("armed");
  ui.deleteDeckBtn.textContent = "Delete deck";
}

/* ---------------------------------------------------------------- views */

const NAV = {
  card: () => ui.navCard,
  collection: () => ui.viewCollectionBtn,
  import: () => ui.importBtn,
};

function showView(panel, navKey) {
  disarmDelete();
  [ui.cardPanel, ui.collectionPanel, ui.deckPanel, ui.importPanel]
    .forEach((node) => { node.hidden = node !== panel; });
  Object.entries(NAV).forEach(([key, node]) =>
    node().classList.toggle("active", key === navKey));
}

function showCollectionView() {
  state.deckId = null;
  state.cardSeq++;          // drop any card still loading; it must not steal the view
  showView(ui.collectionPanel, "collection");
  renderDeckList();
  renderCollection();
}

function showCardView() {
  showView(ui.cardPanel, "card");
}

function openDeck(deckId) {
  state.deckId = deckId;
  state.cardSeq++;          // same here: a slow search must not pull us back
  ui.deckFilter.value = "";
  showView(ui.deckPanel, "deck");   // the deck's own row in the rail lights up
  renderDeckList();
  renderDeckPanel();
}

/* -------------------------------------------------------------- import */

function showImportView() {
  state.cardSeq++;
  state.deckId = null;
  showView(ui.importPanel, "import");
  renderDeckList();
  ui.importText.focus();
}

function resetImportReport() {
  state.importToken = null;
  ui.importReport.hidden = true;
  ui.reportOk.innerHTML = "";
  ui.reportBad.innerHTML = "";
  ui.reportProblemHead.hidden = true;
}

async function previewImport() {
  const text = ui.importText.value;
  if (!text.trim()) return setStatus("Paste a list first.", true);
  resetImportReport();
  ui.previewBtn.disabled = true;
  ui.importHint.textContent = "Looking cards up…";
  try {
    const report = await getJson("/api/collection/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    state.importToken = report.token;
    renderImportReport(report);
    const missed = report.problems.length;
    setStatus(`Found ${report.total} card${report.total === 1 ? "" : "s"}` +
      (missed ? `, ${missed} line${missed === 1 ? "" : "s"} unmatched.` : "."));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    ui.previewBtn.disabled = false;
    ui.importHint.textContent = "";
  }
}

function renderImportReport(report) {
  ui.importReport.hidden = false;
  ui.reportTitle.textContent =
    `${report.total} card${report.total === 1 ? "" : "s"} · ${report.unique} unique`;
  ui.commitBtn.disabled = report.unique === 0;

  ui.reportOk.innerHTML = report.items.map((item) => `
    <li>
      <span class="rq">${item.quantity}×</span>
      <span class="rn">${escapeHtml(item.name)}
        ${item.note ? `<span class="warn">${escapeHtml(item.note)}</span>` : ""}
        ${item.fuzzy && !item.note
          ? `<small>matched from “${escapeHtml(item.asked)}”</small>` : ""}
      </span>
      <span class="rs">${escapeHtml((item.set || "").toUpperCase())} #${escapeHtml(item.collector_number || "")}</span>
    </li>`).join("");

  ui.reportProblemHead.hidden = report.problems.length === 0;
  ui.reportBad.innerHTML = report.problems.map((problem) => `
    <li><span class="rn">${escapeHtml(problem.line)}
      <small>${escapeHtml(problem.reason)}</small></span></li>`).join("");
}

async function commitImport() {
  if (!state.importToken) return;
  ui.commitBtn.disabled = true;
  const data = await mutate("/api/collection/import/commit", { token: state.importToken },
    (d) => `Imported ${d.imported} card${d.imported === 1 ? "" : "s"}.`);
  if (data) {
    resetImportReport();
    ui.importText.value = "";
    showCollectionView();
  } else {
    ui.commitBtn.disabled = false;
  }
}

function readImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    ui.importText.value = String(reader.result || "");
    resetImportReport();
    setStatus(`Loaded ${file.name} — press Preview.`);
  };
  reader.onerror = () => setStatus(`Could not read ${file.name}.`, true);
  reader.readAsText(file);
}

async function openFolder() {
  try {
    const data = await getJson("/api/collection/open", { method: "POST" });
    setStatus(`Opened ${data.folder}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

/* ------------------------------------------------------------- actions */

async function showCard(card, refreshPrintings = true) {
  showCardView();
  state.card = card;
  state.face = 0;
  renderCard(card);
  pushRecent(card);
  if (!refreshPrintings) {
    renderPrintings();
    return;
  }
  state.printings = [card];
  renderPrintings();
  if (!card.prints_search_uri) return;
  const seq = ++state.cardSeq;
  try {
    const data = await getJson(`/api/printings?uri=${encodeURIComponent(card.prints_search_uri)}`);
    if (seq === state.cardSeq && state.card === card) {
      state.printings = data;
      renderPrintings();
    }
  } catch { /* the picker simply stays on the single printing */ }
}

async function load(url) {
  setBusy(true);
  const busySeq = ++state.loadSeq;
  const seq = ++state.cardSeq;
  try {
    const card = await getJson(url);
    if (seq !== state.cardSeq) return;      // a newer request already won
    await showCard(card);
  } catch (error) {
    if (seq !== state.cardSeq) return;
    const extra = (error.suggestions || []).length
      ? `  Did you mean: ${error.suggestions.slice(0, 5).join(", ")}?` : "";
    setStatus(error.message + extra, true);
  } finally {
    // showCard starts a separate printing request and advances cardSeq.  The
    // indicator belongs to this card fetch, not that follow-up request.
    if (busySeq === state.loadSeq) setBusy(false);
  }
}

function renderDeckStats(deck) {
  const curve = Array(7).fill(0);
  const colours = new Map(PIP_ORDER.map((colour) => [colour, 0]));
  const types = new Map();
  let lands = 0;
  let spellCount = 0;
  let manaTotal = 0;

  deck.cards.forEach((line) => {
    const entry = state.entryById.get(line.card_id);
    if (!entry) return;
    const card = entry.card || {};
    const quantity = line.quantity;
    const category = cardCategory(card);
    types.set(category, (types.get(category) || 0) + quantity);
    if (category === "land") {
      lands += quantity;
      return;
    }
    const cmc = Math.max(0, Math.floor(Number(card.cmc) || 0));
    curve[Math.min(cmc, 6)] += quantity;
    spellCount += quantity;
    manaTotal += (Number(card.cmc) || 0) * quantity;
    (card.color_identity || []).forEach((colour) =>
      colours.set(colour, (colours.get(colour) || 0) + quantity));
  });

  if (!deck.cards.length) {
    ui.deckStats.hidden = true;
    return;
  }
  const peak = Math.max(...curve, 1);
  const commander = deck.commander_id ? state.entryById.get(deck.commander_id) : null;
  const identity = commander ? ((commander.card || {}).color_identity || []) : [];
  const typeText = CATEGORIES.filter((category) => category.key !== "commander")
    .map((category) => [category.label, types.get(category.key) || 0])
    .filter(([, count]) => count)
    .map(([label, count]) => `<span>${escapeHtml(label)} <b>${count}</b></span>`).join("");
  const colourText = PIP_ORDER.filter((colour) => colours.get(colour))
    .map((colour) => `<span class="stat-colour ${colour.toLowerCase()}">${colour} <b>${colours.get(colour)}</b></span>`).join("") ||
    '<span class="stat-muted">No coloured spells</span>';

  ui.deckStats.hidden = false;
  ui.deckStats.innerHTML = `
    <div class="stat-overview">
      <span><b>${lands}</b> lands</span>
      <span><b>${spellCount ? (manaTotal / spellCount).toFixed(2) : "—"}</b> avg. mana value</span>
      <span><b>${identityLabel(identity)}</b> identity</span>
    </div>
    <div class="stat-block curve"><h3>Mana curve <small>nonlands</small></h3>
      <div class="curve-bars">${curve.map((count, mana) => `
        <div class="curve-bar" title="${mana === 6 ? "6+" : mana} mana: ${count}">
          <i style="height:${count ? Math.max(12, (count / peak) * 100) : 2}%"></i>
          <b>${count}</b><span>${mana === 6 ? "6+" : mana}</span>
        </div>`).join("")}</div>
    </div>
    <div class="stat-block"><h3>Colour cards</h3><div class="stat-tags">${colourText}</div></div>
    <div class="stat-block"><h3>Types</h3><div class="stat-tags">${typeText || '<span class="stat-muted">No cards yet</span>'}</div></div>`;
}

function search() {
  const name = ui.search.value.trim();
  if (!name) return setStatus("Type a card name first.", true);
  load(`/api/card?name=${encodeURIComponent(name)}`);
}

const random = () => {
  hideSuggestions();
  load("/api/random");
};

function flip() {
  if (!state.card || !isDoubleFaced(state.card)) return;
  state.face = 1 - state.face;
  renderCard(state.card);
}

async function openScryfall() {
  if (!state.card || !state.card.scryfall_uri) return;
  try {
    await getJson("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.card.scryfall_uri }),
    });
  } catch (error) {
    setStatus(error.message, true);
  }
}

/* --------------------------------------------------------------- wiring */

ui.search.addEventListener("input", scheduleSuggest);
ui.search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
  else if (event.key === "Escape") hideSuggestions();
  else if (event.key === "Enter") {
    event.preventDefault();
    if (state.active >= 0) accept(state.active);
    else { hideSuggestions(); search(); }
  }
});
ui.search.addEventListener("blur", () => setTimeout(hideSuggestions, 120));

ui.randomBtn.addEventListener("click", random);
ui.flipBtn.addEventListener("click", flip);
ui.scryfallBtn.addEventListener("click", openScryfall);
ui.printings.addEventListener("change", () => {
  const card = state.printings[+ui.printings.value];
  if (card) showCard(card, false);
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    ui.search.focus();
    ui.search.select();
  }
});

ui.addBtn.addEventListener("click", addToCollection);
ui.removeBtn.addEventListener("click", () => state.card && removeFromCollection(state.card.id));
ui.viewCollectionBtn.addEventListener("click", showCollectionView);
ui.openFolderBtn.addEventListener("click", openFolder);
ui.collectionFilter.addEventListener("input", renderCollection);
ui.collectionSort.addEventListener("change", renderCollection);
ui.collectionGridBtn.addEventListener("click", () => setCollectionView("grid"));
ui.collectionListBtn.addEventListener("click", () => setCollectionView("list"));

ui.navCard.addEventListener("click", showCardView);
ui.brandBtn.addEventListener("click", showCardView);
ui.importBtn.addEventListener("click", showImportView);
ui.previewBtn.addEventListener("click", previewImport);
ui.commitBtn.addEventListener("click", commitImport);
ui.clearImportBtn.addEventListener("click", () => {
  ui.importText.value = "";
  resetImportReport();
  ui.importText.focus();
});
ui.importFileBtn.addEventListener("click", () => ui.importFile.click());
ui.importFile.addEventListener("change", (event) => {
  readImportFile(event.target.files[0]);
  event.target.value = "";        // let the same file be picked again
});
ui.importText.addEventListener("input", () => {
  if (state.importToken) resetImportReport();
});

ui.deckPicker.addEventListener("change", () => { state.pickerDeck = ui.deckPicker.value; });
ui.addToDeckBtn.addEventListener("click", addCurrentToDeck);
ui.newDeckBtn.addEventListener("click", newDeck);
ui.deleteDeckBtn.addEventListener("click", deleteDeck);
ui.deckFilter.addEventListener("input", renderAvailable);
ui.deckName.addEventListener("change", renameDeck);
ui.deckName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.deckName.blur();
  else if (event.key === "Escape") {
    const deck = deckById(state.deckId);
    if (deck) ui.deckName.value = deck.name;
    ui.deckName.blur();
  }
});

ui.logoutBtn.addEventListener("click", signOut);

loadIdentity();
restoreRecent();
loadLibrary();
random();
