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
  settingsBtn: el("settingsBtn"), settingsPanel: el("settingsPanel"),
  settingsCollectionValue: el("settingsCollectionValue"), refreshAllPricesBtn: el("refreshAllPricesBtn"),
  settingsPriceStatus: el("settingsPriceStatus"),
  search: el("search"), suggestions: el("suggestions"),
  randomBtn: el("randomBtn"), toast: el("toast"), navCard: el("navCard"),
  brandBtn: el("brandBtn"),
  recent: el("recent"), recentEmpty: el("recentEmpty"),
  art: el("cardArt"), artPlaceholder: el("artPlaceholder"), flipBtn: el("flipBtn"),
  name: el("cardName"), mana: el("manaCost"), type: el("typeLine"), pt: el("pt"),
  rules: el("rules"), rarityDot: el("rarityDot"), setLine: el("setLine"),
  artist: el("artistLine"), priceChips: el("priceChips"), legalChips: el("legalChips"),
  printings: el("printings"), scryfallBtn: el("scryfallBtn"),
  addBtn: el("addBtn"), removeBtn: el("removeBtn"), wishlistAddBtn: el("wishlistAddBtn"), ownedLabel: el("ownedLabel"),
  viewCollectionBtn: el("viewCollectionBtn"), collCount: el("collCount"),
  wishlistBtn: el("wishlistBtn"), wishlistCount: el("wishlistCount"),
  wishlistPanel: el("wishlistPanel"), wishlistGrid: el("wishlistGrid"),
  wishlistEmpty: el("wishlistEmpty"), wishlistSummary: el("wishlistSummary"),
  wishlistExportBtn: el("wishlistExportBtn"),
  openFolderBtn: el("openFolderBtn"),
  cardPanel: el("cardPanel"), collectionPanel: el("collectionPanel"),
  collGrid: el("collGrid"), collEmpty: el("collEmpty"), collSummary: el("collSummary"),
  collectionFilter: el("collectionFilter"),
  collectionSort: el("collectionSort"), collectionGridBtn: el("collectionGridBtn"),
  collectionListBtn: el("collectionListBtn"), collectionUnusedBtn: el("collectionUnusedBtn"),
  collectionFiltersBtn: el("collectionFiltersBtn"), collectionFiltersPanel: el("collectionFiltersPanel"),
  exportProfileBtn: el("exportProfileBtn"), importProfileBtn: el("importProfileBtn"),
  priceHistoryBtn: el("priceHistoryBtn"), priceHistoryDialog: el("priceHistoryDialog"),
  priceHistoryCloseBtn: el("priceHistoryCloseBtn"), priceHistoryCurrent: el("priceHistoryCurrent"),
  priceHistoryChange: el("priceHistoryChange"), priceHistoryList: el("priceHistoryList"),
  profileImportFile: el("profileImportFile"),
  profileImportDialog: el("profileImportDialog"), profileImportSummary: el("profileImportSummary"),
  profileMergeBtn: el("profileMergeBtn"), profileReplaceBtn: el("profileReplaceBtn"),
  profileImportCancelBtn: el("profileImportCancelBtn"),
  deckList: el("deckList"), deckListEmpty: el("deckListEmpty"), deckMenuBtn: el("deckMenuBtn"),
  deckMenuPanel: el("deckMenuPanel"), deckMenuNewBtn: el("deckMenuNewBtn"),
  deckImportBtn: el("deckImportBtn"), deckImportDialog: el("deckImportDialog"),
  deckImportCloseBtn: el("deckImportCloseBtn"), deckImportName: el("deckImportName"),
  deckImportText: el("deckImportText"), deckImportPreviewBtn: el("deckImportPreviewBtn"),
  deckImportCancelBtn: el("deckImportCancelBtn"), deckImportReport: el("deckImportReport"),
  deckImportSummary: el("deckImportSummary"), deckImportItems: el("deckImportItems"),
  deckImportProblemsTitle: el("deckImportProblemsTitle"), deckImportProblems: el("deckImportProblems"),
  deckPanel: el("deckPanel"), deckName: el("deckName"), deckSummary: el("deckSummary"),
  deckCategory: el("deckCategory"), deckPrice: el("deckPrice"), deckExportBtn: el("deckExportBtn"),
  deckUnownedPrice: el("deckUnownedPrice"),
  deckExportDialog: el("deckExportDialog"), deckExportText: el("deckExportText"),
  goldfishBtn: el("goldfishBtn"), goldfishDialog: el("goldfishDialog"),
  goldfishHand: el("goldfishHand"), goldfishSummary: el("goldfishSummary"),
  deckExportCloseBtn: el("deckExportCloseBtn"), deckExportCancelBtn: el("deckExportCancelBtn"),
  deckCopyBtn: el("deckCopyBtn"),
  deckGrid: el("deckGrid"), deckEmpty: el("deckEmpty"), deckFilter: el("deckFilter"),
  deckStats: el("deckStats"),
  deleteDeckBtn: el("deleteDeckBtn"),
  deckLegality: el("deckLegality"), deckProblems: el("deckProblems"),
  deckMenuWrap: el("deckMenuWrap"), deckPicker: el("deckPicker"), addToDeckBtn: el("addToDeckBtn"),
  deckZoneBtn: el("deckZoneBtn"), deckZonePicker: el("deckZonePicker"),
  deckSearchBtn: el("deckSearchBtn"), deckSuggestions: el("deckSuggestions"),
  proxyListBtn: el("proxyListBtn"),
  importBtn: el("importBtn"), importPanel: el("importPanel"), importText: el("importText"),
  importFile: el("importFile"), importFileBtn: el("importFileBtn"),
  previewBtn: el("previewBtn"), commitBtn: el("commitBtn"), clearImportBtn: el("clearImportBtn"),
  importReport: el("importReport"), reportTitle: el("reportTitle"), reportOk: el("reportOk"),
  reportBad: el("reportBad"), reportProblemHead: el("reportProblemHead"),
  importHint: el("importHint"),
  whoami: el("whoami"), whoName: el("whoName"), logoutBtn: el("logoutBtn"),
  cardPreview: el("cardPreview"), previewArt: el("previewArt"),
  commandPalette: el("commandPalette"), commandInput: el("commandInput"),
  commandList: el("commandList"),
  cardDetailDialog: el("cardDetailDialog"), detailCloseBtn: el("detailCloseBtn"),
  detailArt: el("detailArt"), detailKicker: el("detailKicker"), detailName: el("detailName"),
  detailType: el("detailType"), detailRules: el("detailRules"), detailMeta: el("detailMeta"),
  detailActions: el("detailActions"),
  proxyDialog: el("proxyDialog"), proxyCloseBtn: el("proxyCloseBtn"),
  proxyList: el("proxyList"), proxyEmpty: el("proxyEmpty"),
};

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* preference is optional */ }
}

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
  library: { entries: [], decks: [], wishlist: [], summary: {} },  // loaded once, then patched
  entryById: new Map(),
  deckId: null,        // deck currently open in the builder
  deleteTimer: null,
  importToken: null,   // ties a previewed import to its commit
  problems: new Map(), // card id -> Commander rule breaks in the open deck
  collectionView: readPreference("mtg.collection-view", "grid"),
  collectionSort: readPreference("mtg.collection-sort", "name"),
  unusedOnly: readPreference("mtg.collection-unused", "0") === "1",
  collectionFilters: { availability: "all", colors: new Set(), type: "all", rarity: "all" },
  priceRefreshChecked: false,
  unownedPriceKey: null,
  commandItems: [],
  commandIndex: 0,
  pendingProfile: null,
  deckZone: "main",
  deckSuggestionNames: [],
  deckActive: -1,
  deckSuggestTimer: null,
  deckSuggestSeq: 0,
  deckImportToken: null,
};

ui.collectionSort.value = state.collectionSort;
if (!ui.collectionSort.value) {
  state.collectionSort = "name";
  ui.collectionSort.value = "name";
}

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

function artCropUrl(card, index) {
  const source = isDoubleFaced(card) ? faceOf(card, index) : card;
  const uris = source.image_uris || card.image_uris || {};
  return uris.art_crop || "";
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
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Request failed (${response.status}): the server returned an unexpected response. Check the mtgviewer service log.`);
  }
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
    configureAccountSettings(me);
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

function priceChipsHtml(card) {
  const prices = card.prices || {};
  const money = [
    ["usd", "USD", "$", "legal"], ["usd_foil", "FOIL", "$", "restricted"],
  ].filter(([key]) => prices[key])
   .map(([key, label, symbol, tone]) =>
     `<span class="chip ${tone}">${label}<span class="v">${symbol}${escapeHtml(prices[key])}</span></span>`);
  return money.length
    ? money.join("")
    : '<span class="chip not_legal">No USD price data</span>';
}

function legalityChipsHtml(card) {
  const legalities = card.legalities || {};
  return FORMATS.map((fmt) => {
    const status = legalities[fmt] || "not_legal";
    const label = fmt.charAt(0).toUpperCase() + fmt.slice(1);
    return `<span class="chip ${status}">${label}</span>`;
  }).join("");
}

function renderChips(card) {
  ui.priceChips.innerHTML = priceChipsHtml(card);
  ui.legalChips.innerHTML = legalityChipsHtml(card);
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
  data.wishlist = data.wishlist || [];
  state.library = data;
  state.entryById = new Map(data.entries.map((e) => [e.id, e]));
  applySummary(data.summary);
  renderDeckList();
  renderOwned();
  if (!ui.collectionPanel.hidden) renderCollection();
  if (!ui.wishlistPanel.hidden) renderWishlist();
  if (!ui.deckPanel.hidden) renderDeckPanel();
}

function hideDeckSuggestions() {
  ui.deckSuggestions.hidden = true;
  ui.deckSuggestions.innerHTML = "";
  state.deckSuggestionNames = [];
  state.deckActive = -1;
}

function chooseDeckSuggestion(name) {
  ui.deckFilter.value = name;
  hideDeckSuggestions();
  searchDeckCard();
}

function showDeckSuggestions(names) {
  if (!names.length) return hideDeckSuggestions();
  state.deckSuggestionNames = names;
  state.deckActive = -1;
  ui.deckSuggestions.innerHTML = names.map((name) =>
    `<li data-name="${escapeHtml(name)}">${escapeHtml(name)}</li>`).join("");
  ui.deckSuggestions.querySelectorAll("li").forEach((item, index) => {
    item.addEventListener("mouseenter", () => highlightDeckSuggestion(index));
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      chooseDeckSuggestion(item.dataset.name);
    });
  });
  ui.deckSuggestions.hidden = false;
}

function highlightDeckSuggestion(index) {
  state.deckActive = index;
  [...ui.deckSuggestions.children].forEach((item, i) =>
    item.classList.toggle("active", i === index));
}

function moveDeckSuggestion(step) {
  if (!state.deckSuggestionNames.length) return;
  const count = state.deckSuggestionNames.length;
  const next = state.deckActive === -1
    ? (step > 0 ? 0 : count - 1)
    : (state.deckActive + step + count) % count;
  highlightDeckSuggestion(next);
  ui.deckSuggestions.children[next].scrollIntoView({ block: "nearest" });
}

function scheduleDeckSuggest() {
  clearTimeout(state.deckSuggestTimer);
  const query = ui.deckFilter.value.trim();
  if (query.length < 2) return hideDeckSuggestions();
  state.deckSuggestTimer = setTimeout(async () => {
    const seq = ++state.deckSuggestSeq;
    try {
      const names = await getJson(`/api/autocomplete?q=${encodeURIComponent(query)}`);
      if (seq === state.deckSuggestSeq && ui.deckFilter.value.trim() === query) {
        showDeckSuggestions(names);
      }
    } catch { /* deck suggestions are optional */ }
  }, SUGGEST_DELAY);
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
  if (data.wishlist) state.library.wishlist = data.wishlist;
  state.entryById = new Map(state.library.entries.map((entry) => [entry.id, entry]));
  applySummary(data.summary);
  renderDeckList();
  renderOwned();
  if (!ui.collectionPanel.hidden) renderCollection();
  if (!ui.wishlistPanel.hidden) renderWishlist();
  if (!ui.deckMenuPanel.hidden) renderDeckList();
  if (!ui.deckPanel.hidden) renderDeckPanel();
}

async function loadLibrary() {
  try {
    applyLibrary(await getJson("/api/library"));
  } catch (error) {
    ui.collSummary.textContent = "Collection could not be loaded.";
    ui.collEmpty.hidden = false;
    ui.collEmpty.textContent = "The server could not load your collection. Refresh to retry; this is not an empty collection result.";
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
  ui.settingsCollectionValue.textContent = money(summary.value);
  ui.collCount.textContent = summary.total;
  ui.wishlistCount.textContent = (state.library.wishlist || []).length;
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
  ui.wishlistAddBtn.disabled = !state.card;
  const wished = state.card && (state.library.wishlist || []).find((item) => item.id === state.card.id);
  ui.wishlistAddBtn.textContent = wished?.manual_quantity ? "Wish for another" : "Add to wishlist";
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

  const canDeck = Boolean(state.card) && decks.length > 0;
  ui.deckMenuWrap.hidden = !canDeck;
  if (canDeck) {
    ui.addToDeckBtn.textContent = held ? "Add to deck" : "Add proxy to deck";
    ui.deckPicker.innerHTML = decks.map((deck) => `
      <button data-deck="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}
        <small>${deck.count} main</small></button>`).join("");
    ui.deckPicker.querySelectorAll("[data-deck]").forEach((button) => {
      button.addEventListener("click", () => addCurrentToDeck(button.dataset.deck));
    });
  }
}

const addToCollection = () => state.card && mutate(
  "/api/collection/add", { card: state.card },
  (d) => `Added ${d.entry.name} — you now hold ${d.entry.quantity}.`);

const removeFromCollection = (cardId) => mutate(
  "/api/collection/remove", { id: cardId },
  (d) => (d.entry ? `Removed one copy — ${d.entry.quantity} left.`
                  : "Removed from the collection."));

const addToWishlist = () => state.card && mutate(
  "/api/wishlist/add", { card: state.card },
  () => `Added ${state.card.name} to your wishlist.`);

const removeFromWishlist = (cardId) => mutate(
  "/api/wishlist/remove", { id: cardId },
  () => "Removed one manual wish. Deck proxy needs are unchanged.");

function addCurrentToDeck(deckId) {
  if (!state.card || !deckId) return;
  ui.deckPicker.hidden = true;
  mutate("/api/decks/add", { deck_id: deckId, card_id: state.card.id, card: state.card },
    (data) => data.proxy_added
      ? `Proxy added to ${deckName(deckId)}.`
      : `Added ${state.card.name} to ${deckName(deckId)}.`);
}

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
  persistCollectionFilters();
  hideCardPreview();
  const allEntries = state.library.entries || [];
  const terms = ui.collectionFilter.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filters = state.collectionFilters;
  const entries = allEntries
    .filter((entry) => {
      const text = collectionSearchText(entry);
      const card = entry.card || {};
      const colours = card.color_identity || card.colors || [];
      const availability = filters.availability === "all" ||
        (filters.availability === "free" && (entry.available || 0) > 0) ||
        (filters.availability === "allocated" && (entry.allocated || 0) > 0);
      const type = filters.type === "all" ||
        (card.type_line || "").toLocaleLowerCase().includes(filters.type);
      const rarity = filters.rarity === "all" || card.rarity === filters.rarity;
      const selectedColors = filters.colors;
      const colour = [...selectedColors].every((color) =>
        color === "colorless" ? colours.length === 0 : colours.includes(color));
      return terms.every((term) => text.includes(term)) && availability && type && rarity && colour &&
        (!state.unusedOnly || (entry.allocated || 0) === 0);
    })
    .sort(collectionComparator(ui.collectionSort.value));
  ui.collGrid.classList.toggle("list-view", state.collectionView === "list");
  ui.collectionGridBtn.classList.toggle("active", state.collectionView === "grid");
  ui.collectionListBtn.classList.toggle("active", state.collectionView === "list");
  ui.collectionGridBtn.setAttribute("aria-pressed", state.collectionView === "grid");
  ui.collectionListBtn.setAttribute("aria-pressed", state.collectionView === "list");
  ui.collectionUnusedBtn.classList.toggle("active", state.unusedOnly);
  ui.collectionUnusedBtn.setAttribute("aria-pressed", state.unusedOnly);
  ui.collectionFiltersBtn.classList.toggle("active", !ui.collectionFiltersPanel.hidden);
  ui.collectionFiltersBtn.setAttribute("aria-expanded", String(!ui.collectionFiltersPanel.hidden));
  ui.collectionFiltersPanel.querySelectorAll("[data-collection-filter]").forEach((button) => {
    const { collectionFilter, value } = button.dataset;
    button.classList.toggle("active", collectionFilter === "color"
      ? (value === "all" ? filters.colors.size === 0 : filters.colors.has(value))
      : filters[collectionFilter] === value);
  });
  ui.collEmpty.hidden = entries.length > 0;
  if (!entries.length) {
    const noUnused = !allEntries.some((entry) => (entry.allocated || 0) === 0);
    ui.collEmpty.textContent = allEntries.length
      ? (state.unusedOnly && noUnused
        ? "Every card is allocated to a deck."
        : "No cards match the current search and filters.")
      : "Nothing saved yet — find a card and add it to the collection, or import a list.";
  }
  ui.collGrid.innerHTML = entries.map((entry) => `
    <figure class="coll-card" data-id="${escapeHtml(entry.id)}" tabindex="0">
      ${thumbHtml(entry, `×${entry.quantity}`,
        `<button class="drop" data-drop="${escapeHtml(entry.id)}" title="Remove one copy">−</button>`)}
      ${locationChips(entry)}
    </figure>`).join("");
  wireTiles(ui.collGrid, (id) => openCardById(id));
}

function renderWishlist() {
  hideCardPreview();
  const items = state.library.wishlist || [];
  ui.wishlistCount.textContent = items.length;
  ui.wishlistExportBtn.disabled = items.length === 0;
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  ui.wishlistSummary.textContent = `${total} card${total === 1 ? "" : "s"} across ${items.length} printing${items.length === 1 ? "" : "s"}. Manual wishes and deck proxies are merged without double-counting.`;
  ui.wishlistEmpty.hidden = items.length > 0;
  ui.wishlistGrid.innerHTML = items.map((item) => {
    const sources = [];
    if (item.manual_quantity) sources.push(`<span class="loc free">Wish ×${item.manual_quantity}</span>`);
    item.proxy_decks.forEach((deck) => sources.push(
      `<span class="loc deck" data-deck="${escapeHtml(deck.deck_id)}">${escapeHtml(deck.deck_name)} ×${deck.quantity}</span>`));
    const remove = item.manual_quantity
      ? `<button class="drop wishlist-remove" data-wish-drop="${escapeHtml(item.id)}" title="Remove one manual wish">−</button>` : "";
    return `<figure class="coll-card" data-id="${escapeHtml(item.id)}" tabindex="0">
      ${thumbHtml(item, `×${item.quantity}`, remove)}
      <div class="wishlist-sources">${sources.join("")}</div>
    </figure>`;
  }).join("");
  wireTiles(ui.wishlistGrid, (id) => openCardById(id));
  ui.wishlistGrid.querySelectorAll("[data-wish-drop]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFromWishlist(button.dataset.wishDrop);
    });
  });
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
  savePreference("mtg.collection-view", view);
  renderCollection();
}

function toggleUnusedCollection() {
  state.unusedOnly = !state.unusedOnly;
  savePreference("mtg.collection-unused", state.unusedOnly ? "1" : "0");
  renderCollection();
}

function toggleCollectionFilters() {
  ui.collectionFiltersPanel.hidden = !ui.collectionFiltersPanel.hidden;
  renderCollection();
}

function setCollectionFilter(kind, value) {
  if (kind === "color") {
    if (value === "all") state.collectionFilters.colors.clear();
    else if (state.collectionFilters.colors.has(value)) state.collectionFilters.colors.delete(value);
    else state.collectionFilters.colors.add(value);
    renderCollection();
    return;
  }
  if (!(kind in state.collectionFilters)) return;
  state.collectionFilters[kind] = value;
  renderCollection();
}

async function exportProfile() {
  try {
    const profile = await getJson("/api/profile/export");
    const filename = `mtg-profile-${new Date().toISOString().slice(0, 10)}.json`;
    const contents = JSON.stringify(profile, null, 2);
    const desktopApi = window.pywebview && window.pywebview.api;
    if (desktopApi && desktopApi.save_profile) {
      const result = await desktopApi.save_profile(contents, filename);
      if (result.cancelled) return setStatus("Profile export cancelled.");
      if (!result.ok) throw new Error(result.error || "Could not save that profile.");
      recordBackup();
      return setStatus(`Profile saved to ${result.path}`);
    }
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    recordBackup();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Profile exported — keep the file somewhere safe.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function money(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

async function openPriceHistory() {
  try {
    const data = await getJson("/api/prices/history");
    const history = data.history || [];
    ui.priceHistoryCurrent.textContent = money(data.current);
    const previous = history[1];
    const refreshNote = data.stale
      ? " Showing the last cached prices."
      : data.refreshed ? " Prices refreshed today." : "";
    if (previous) {
      const difference = (Number(data.current) || 0) - (Number(previous.value) || 0);
      ui.priceHistoryChange.textContent = `${difference >= 0 ? "+" : "−"}${money(Math.abs(difference))} since ${previous.day}.${refreshNote}`;
    } else {
      ui.priceHistoryChange.textContent = `Tracking starts today; prices refresh once daily when you open this view.${refreshNote}`;
    }
    ui.priceHistoryList.innerHTML = history.map((point) => `
      <li><time datetime="${escapeHtml(point.day)}">${escapeHtml(point.day)}</time><strong>${money(point.value)}</strong></li>`).join("");
    ui.priceHistoryDialog.hidden = false;
  } catch (error) {
    setStatus(error.message, true);
  }
}

function readProfileFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      showProfileImportDialog(JSON.parse(String(reader.result || "")));
    } catch {
      setStatus("That file is not valid JSON.", true);
    }
  };
  reader.onerror = () => setStatus(`Could not read ${file.name}.`, true);
  reader.readAsText(file);
}

function showProfileImportDialog(profile) {
  const printings = Array.isArray(profile && profile.collection) ? profile.collection.length : 0;
  const decks = Array.isArray(profile && profile.decks) ? profile.decks.length : 0;
  state.pendingProfile = profile;
  ui.profileImportSummary.textContent =
    `This backup contains ${printings} printing${printings === 1 ? "" : "s"} and ` +
    `${decks} deck${decks === 1 ? "" : "s"}.`;
  ui.profileImportDialog.hidden = false;
}

function closeProfileImportDialog() {
  ui.profileImportDialog.hidden = true;
  state.pendingProfile = null;
}

async function importProfile(mode) {
  const profile = state.pendingProfile;
  if (!profile) return;
  if (mode === "replace" && !window.confirm(
    "Replace your current collection? This permanently deletes your existing cards and decks before restoring this backup.")) return;
  ui.profileImportDialog.hidden = true;
  try {
    const data = await getJson("/api/profile/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, mode }),
    });
    state.pendingProfile = null;
    applyLibrary(data);
    const report = data.imported_profile || {};
    const skipped = (report.skipped_cards || 0) + (report.skipped_deck_cards || 0);
    setStatus(
      `${mode === "replace" ? "Restored" : "Imported"} ${report.cards || 0} card${report.cards === 1 ? "" : "s"} and ` +
      `${report.decks || 0} deck${report.decks === 1 ? "" : "s"}.` +
      (skipped ? ` Skipped ${skipped} incomplete record${skipped === 1 ? "" : "s"}.` : ""),
    );
  } catch (error) {
    state.pendingProfile = null;
    setStatus(error.message, true);
  }
}

function setCollectionSort() {
  state.collectionSort = ui.collectionSort.value;
  savePreference("mtg.collection-sort", state.collectionSort);
  renderCollection();
}

function showCardPreview(cardOrId, anchor) {
  const entry = typeof cardOrId === "string" ? state.entryById.get(cardOrId) : null;
  const card = entry ? (entry.card || {}) : (cardOrId || {});
  if (!Object.keys(card).length) return;
  const art = imageUrl(card, 0);
  ui.previewArt.src = art ? `/img?u=${encodeURIComponent(art)}` : "";
  ui.previewArt.alt = (entry && entry.name) || card.name || "";
  ui.cardPreview.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const width = ui.cardPreview.offsetWidth || 256;
  const height = ui.cardPreview.offsetHeight || 520;
  const left = rect.left > window.innerWidth * 0.57
    ? Math.max(12, rect.left - width - 14)
    : Math.min(window.innerWidth - width - 12, rect.right + 14);
  const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12));
  ui.cardPreview.style.left = `${left}px`;
  ui.cardPreview.style.top = `${top}px`;
}

function closeDeckImportDialog() {
  ui.deckImportDialog.hidden = true;
  state.deckImportToken = null;
}

function openDeckImportDialog() {
  state.deckImportToken = null;
  ui.deckImportName.value = "";
  ui.deckImportText.value = "";
  ui.deckImportReport.hidden = true;
  ui.deckImportItems.innerHTML = "";
  ui.deckImportProblems.innerHTML = "";
  ui.deckImportDialog.hidden = false;
  ui.deckImportName.focus();
}

function deckImportItemHtml(item) {
  const printing = [item.set && String(item.set).toUpperCase(), item.collector_number && `#${item.collector_number}`]
    .filter(Boolean).join(" ");
  return `<li><span>${escapeHtml(item.name)}</span><small>×${item.quantity}${printing ? ` · ${escapeHtml(printing)}` : ""}</small></li>`;
}

async function previewDeckImport() {
  try {
    const report = await getJson("/api/decks/import/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ui.deckImportText.value }),
    });
    state.deckImportToken = report.token;
    ui.deckImportSummary.textContent = `${report.total} cards · ${report.unique} unique printing${report.unique === 1 ? "" : "s"} resolved`;
    ui.deckImportItems.innerHTML = (report.items || []).map(deckImportItemHtml).join("");
    const problems = report.problems || [];
    ui.deckImportProblemsTitle.hidden = problems.length === 0;
    ui.deckImportProblems.innerHTML = problems.map((problem) =>
      `<li><span>${escapeHtml(problem.line)}</span><small>${escapeHtml(problem.reason)}</small></li>`).join("");
    ui.deckImportReport.hidden = false;
  } catch (error) {
    state.deckImportToken = null;
    setStatus(error.message, true);
  }
}

async function commitDeckImport(mode) {
  if (!state.deckImportToken) return setStatus("Preview the decklist first.", true);
  try {
    const data = await getJson("/api/decks/import/commit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.deckImportToken, name: ui.deckImportName.value, mode }),
    });
    const report = data.imported_deck || {};
    applyLibrary(data);
    closeDeckImportDialog();
    openDeck(report.deck_id);
    const details = [`${report.owned || 0} owned`, `${report.proxies || 0} proxies`];
    if (report.added_to_collection) details.push(`${report.added_to_collection} added to collection`);
    if (report.skipped) details.push(`${report.skipped} skipped`);
    setStatus(`Imported ${report.name || "deck"} — ${details.join(", ")}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function hideCardPreview() {
  ui.cardPreview.hidden = true;
  ui.previewArt.removeAttribute("src");
}

function lineCard(line) {
  return (state.entryById.get(line.card_id) || {}).card || line.card || {};
}

function lineName(line) {
  const entry = state.entryById.get(line.card_id);
  return (entry && entry.name) || lineCard(line).name || line.card_id;
}

function closeCardDetail() {
  ui.cardDetailDialog.hidden = true;
  ui.detailArt.removeAttribute("src");
  if (ui.detailFacts) ui.detailFacts.innerHTML = "";
  ui.detailActions.innerHTML = "";
}

function detailFactsElement() {
  if (ui.detailFacts) return ui.detailFacts;
  // A cached page shell from before the richer detail view did not include
  // this optional region. Create it on demand so it cannot block the dialog.
  const facts = document.createElement("div");
  facts.className = "detail-facts";
  facts.id = "detailFacts";
  ui.detailActions.parentNode.insertBefore(facts, ui.detailActions);
  ui.detailFacts = facts;
  return facts;
}

function detailFactsHtml(card, shown) {
  const title = (text) => String(text || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const identity = (card.color_identity || []).join(" ") || "Colourless";
  const set = [card.set_name, card.set && String(card.set).toUpperCase()]
    .filter(Boolean).join(" · ");
  const printing = [set, card.collector_number && `#${card.collector_number}`]
    .filter(Boolean).join(" ");
  const facts = [
    ["Mana cost", shown.mana_cost ? manaHtml(shown.mana_cost, true) : "—"],
    ["Mana value", Number.isFinite(Number(card.cmc)) ? Number(card.cmc) : "—"],
    ["Identity", escapeHtml(identity)],
    ["Rarity", escapeHtml(title(card.rarity || "Unknown"))],
    ["Printing", escapeHtml(printing || "Unknown")],
    ["Artist", escapeHtml(card.artist || "Unknown")],
  ];
  return `<div class="detail-fact-grid">${facts.map(([label, value]) =>
    `<div><span>${label}</span><b>${value}</b></div>`).join("")}</div>
    <section class="detail-info-section"><h3>Prices</h3><div class="chips">${priceChipsHtml(card)}</div></section>
    <section class="detail-info-section"><h3>Format legality</h3><div class="chips">${legalityChipsHtml(card)}</div></section>`;
}

function detailBase(card, kicker, meta) {
  const shown = frontFace(card);
  const art = imageUrl(card, 0);
  ui.detailKicker.textContent = kicker;
  ui.detailName.textContent = shown.name || card.name || "Unknown card";
  ui.detailType.textContent = shown.type_line || card.type_line || "";
  ui.detailRules.innerHTML = (shown.oracle_text || card.oracle_text || "No rules text.")
    .split("\n").filter(Boolean).map((line) => `<p>${withInlinePips(line)}</p>`).join("");
  ui.detailMeta.textContent = meta || "";
  try {
    detailFactsElement().innerHTML = detailFactsHtml(card, shown);
  } catch {
    detailFactsElement().textContent = "Additional card details are unavailable for this printing.";
  }
  ui.detailArt.src = art ? `/img?u=${encodeURIComponent(art)}` : "";
  ui.detailArt.alt = card.name || "";
  ui.cardDetailDialog.hidden = false;
}

function openCollectionDetail(cardId) {
  const entry = state.entryById.get(cardId);
  if (!entry) return;
  hideCardPreview();
  const locations = (entry.locations || []).map((line) => `${line.deck_name} ×${line.quantity}`).join(" · ");
  detailBase(entry.card || {}, "Collection card",
    `${entry.quantity} owned · ${entry.available} free${locations ? ` · ${locations}` : ""}`);
  ui.detailActions.innerHTML = `<button class="btn primary" data-detail-add>Add another</button>
    <button class="btn" data-detail-remove>Remove one</button>
    <label class="detail-proxy-picker">Proxy destination
      <select class="view-select" data-proxy-deck aria-label="Deck for proxy">
        ${(state.library.decks || []).map((deck) =>
          `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join("")}
      </select>
    </label>
    <button class="btn" data-detail-add-proxy>Add proxy to deck</button>
    <p class="sub">${state.library.decks.length
      ? "Adds a proxy to the main deck. Your owned copies remain available."
      : "Create a deck first to add a proxy."}</p>`;
  const proxyButton = ui.detailActions.querySelector("[data-detail-add-proxy]");
  const proxyDeck = ui.detailActions.querySelector("[data-proxy-deck]");
  proxyButton.disabled = proxyDeck.disabled = !state.library.decks.length;
  proxyButton.addEventListener("click", async () => {
    const deckId = proxyDeck.value;
    if (!deckId || proxyButton.disabled) return;
    proxyButton.disabled = true;
    const result = await mutate("/api/decks/add", {
      deck_id: deckId, card_id: cardId, force_proxy: true,
    }, () => `Proxy added to ${deckName(deckId)}.`);
    if (result && proxyButton.isConnected) closeCardDetail();
    else proxyButton.disabled = false;
  });
  ui.detailActions.querySelector("[data-detail-add]").addEventListener("click", () => {
    mutate("/api/collection/add", { card: entry.card }, () => `Added ${entry.name}.`);
  });
  ui.detailActions.querySelector("[data-detail-remove]").addEventListener("click", () => {
    removeFromCollection(cardId);
    closeCardDetail();
  });
}

function openDeckDetail(deckId, cardId) {
  const deck = deckById(deckId);
  const line = deck && deck.cards.find((item) => item.card_id === cardId);
  if (!line) return;
  hideCardPreview();
  const card = lineCard(line);
  detailBase(card, line.proxy ? "Proxy" : "Deck card",
    `${line.quantity} in ${line.zone === "maybeboard" ? "maybeboard" : "main deck"}`);
  const destination = line.zone === "main" ? "maybeboard" : "main";
  const destinationLabel = destination === "main" ? "Move to main deck" : "Move to maybeboard";
  ui.detailActions.innerHTML = `
    <button class="btn${line.proxy ? " primary" : ""}" data-detail-proxy>
      ${line.proxy ? "Use owned copy" : "Mark as proxy"}</button>
    <button class="btn" data-detail-move>${destinationLabel}</button>
    <button class="btn quiet danger" data-detail-remove>Remove one</button>`;
  ui.detailActions.querySelector("[data-detail-proxy]").addEventListener("click", () => {
    mutate("/api/decks/proxy", { deck_id: deckId, card_id: cardId, proxy: !line.proxy },
      () => !line.proxy ? "Proxy enabled." : "Using an owned copy.");
    closeCardDetail();
  });
  ui.detailActions.querySelector("[data-detail-move]").addEventListener("click", () => {
    mutate("/api/decks/move", { deck_id: deckId, card_id: cardId, zone: destination },
      () => `Moved to ${destination === "main" ? "the main deck" : "the maybeboard"}.`);
    closeCardDetail();
  });
  ui.detailActions.querySelector("[data-detail-remove]").addEventListener("click", () => {
    mutate("/api/decks/remove", { deck_id: deckId, card_id: cardId }, () => "Removed one copy.");
    closeCardDetail();
  });
  loadDetailPrintings(deckId, line, card);
}

async function loadDetailPrintings(deckId, line, card) {
  const section = document.createElement("section");
  section.className = "detail-info-section detail-printing";
  section.innerHTML = `<label for="detailPrinting">Change printing</label>
    <select id="detailPrinting" class="deck-picker" disabled aria-describedby="detailPrintingHelp"></select>
    <p id="detailPrintingHelp" class="detail-meta">${line.proxy
      ? "Changes all copies on this proxy row. Your collection stays the same."
      : "Changes all copies on this deck row and the same number in your collection."}</p>
    <p class="detail-meta" data-printing-status role="status">Loading printings…</p>`;
  detailFactsElement().appendChild(section);
  const select = section.querySelector("select");
  const status = section.querySelector("[data-printing-status]");
  const label = (item) => `${item.set_name || (item.set || "").toUpperCase()} #${item.collector_number || "?"} · ${item.released_at || "Unknown date"}`;
  select.add(new Option(label(card), card.id));
  try {
    const data = card.prints_search_uri
      ? await getJson(`/api/printings?uri=${encodeURIComponent(card.prints_search_uri)}`) : [];
    if (!section.isConnected || ui.cardDetailDialog.hidden) return;
    const printings = [card, ...data.filter((item) => item.id !== card.id)];
    select.replaceChildren(...printings.map((item) => new Option(label(item), item.id)));
    select.value = card.id;
    select.disabled = printings.length < 2;
    status.textContent = printings.length < 2 ? "No other printings available." : "";
    select.addEventListener("change", async () => {
      const chosen = printings.find((item) => item.id === select.value);
      if (!chosen || chosen.id === card.id) return;
      const buttons = [...ui.detailActions.querySelectorAll("button")];
      select.disabled = true;
      buttons.forEach((button) => { button.disabled = true; });
      status.textContent = "Saving printing…";
      try {
        const result = await getJson("/api/decks/printing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deck_id: deckId, card_id: card.id, card: chosen }),
        });
        applyPatch(result);
        setStatus(line.proxy ? "Proxy printing updated." : "Printing updated in deck and collection.");
        if (section.isConnected && !ui.cardDetailDialog.hidden) openDeckDetail(deckId, chosen.id);
      } catch (error) {
        select.value = card.id;
        status.textContent = error.message;
      } finally {
        select.disabled = false;
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
  } catch (error) {
    if (section.isConnected) status.textContent = `Could not load printings: ${error.message}. Reopen this card to retry.`;
  }
}

function openProxyList() {
  const deck = deckById(state.deckId);
  if (!deck) return;
  const proxies = deck.cards.filter((line) => line.proxy);
  ui.proxyList.innerHTML = proxies.map((line) => `
    <li data-card="${escapeHtml(line.card_id)}"><span>${escapeHtml(lineName(line))}</span>
      <small>${line.quantity} × ${line.zone === "main" ? "main" : "maybeboard"}</small></li>`).join("");
  ui.proxyEmpty.hidden = proxies.length > 0;
  ui.proxyList.querySelectorAll("li").forEach((item) => item.addEventListener("click", () => {
    ui.proxyDialog.hidden = true;
    openDeckDetail(deck.id, item.dataset.card);
  }));
  ui.proxyDialog.hidden = false;
}

/** Shared tile behaviour: open the card, drop a copy, or jump to a deck. */
function wireTiles(root, onOpen) {
  root.querySelectorAll(".coll-card").forEach((node) => {
    node.addEventListener("click", (event) => {
      const target = event.target;
      if (target.dataset.drop || target.dataset.wishDrop || target.dataset.deck || target.dataset.step) return;
      onOpen(node.dataset.id);
    });
    node.addEventListener("mouseenter", () => showCardPreview(node.dataset.id, node));
    node.addEventListener("mouseleave", hideCardPreview);
    node.addEventListener("focusin", () => showCardPreview(node.dataset.id, node));
    node.addEventListener("focusout", (event) => {
      if (!node.contains(event.relatedTarget)) hideCardPreview();
    });
    node.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === node) {
        event.preventDefault();
        onOpen(node.dataset.id);
      }
    });
  });
  root.querySelectorAll("[data-drop]").forEach((node) => {
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
  openCollectionDetail(cardId);
}

/* ------------------------------------------------------------- decking */

const deckById = (id) => (state.library.decks || []).find((d) => d.id === id);
const deckName = (id) => (deckById(id) || {}).name || "the deck";

function deckCoverHtml(deck) {
  const commanderLine = deck.commander_id
    ? deck.cards.find((line) => line.card_id === deck.commander_id)
    : null;
  const coverLine = commanderLine || deck.cards.find((line) => line.zone === "main");
  if (!coverLine) {
    return '<span class="deck-cover empty-cover" aria-hidden="true"><svg class="ico"><use href="#i-decks"/></svg></span>';
  }
  const card = lineCard(coverLine);
  const art = artCropUrl(card, 0);
  return `<span class="deck-cover${commanderLine ? " commander-cover" : ""}" aria-hidden="true">
    ${art ? `<img src="/img?u=${encodeURIComponent(art)}" alt="" loading="lazy">` : '<svg class="ico"><use href="#i-decks"/></svg>'}
    ${commanderLine ? '<i>Commander</i>' : ""}
  </span>`;
}

function renderDeckList() {
  const decks = state.library.decks || [];
  ui.deckListEmpty.hidden = decks.length > 0;
  const folders = new Map();
  decks.forEach((deck) => {
    const folder = deck.category || "Uncategorized";
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push(deck);
  });
  ui.deckList.innerHTML = [...folders.entries()].sort(([a], [b]) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  }).map(([folder, items]) => `
    <section class="deck-folder">
      <h2>${escapeHtml(folder)}</h2>
      <div class="deck-folder-cards">${items.map((deck) => `
        <button class="deck-directory-card" data-id="${escapeHtml(deck.id)}">
          ${deckCoverHtml(deck)}
          <span class="deck-directory-copy">
            <span class="deck-directory-title">${escapeHtml(deck.name)}</span>
            <span class="deck-directory-meta">${deck.count} main cards · ${deck.maybeboard_count || 0} maybeboard · ${deck.cards.length} unique</span>
          </span>
        </button>`).join("")}</div>
    </section>`).join("");
  ui.deckList.querySelectorAll(".deck-directory-card").forEach((item) => {
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
  { key: "maybeboard", label: "Maybeboard" },
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
  deck.cards.filter((line) => line.zone === "main").forEach((line) => {
    const card = lineCard(line);
    const name = lineName(line);
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

  const commanderLine = deck.cards.find((line) => line.card_id === deck.commander_id);
  const commander = commanderLine ? { name: lineName(commanderLine), card: lineCard(commanderLine) } : null;
  const identity = commander
    ? new Set((commander.card || {}).color_identity || []) : null;

  deck.cards.filter((line) => line.zone === "main").forEach((line) => {
    const card = lineCard(line);

    // Format legality holds whether or not a commander has been named.
    const status = (card.legalities || {}).commander;
    if (BAD_LEGALITY[status]) {
      note(line.card_id, `${lineName(line)} is ${BAD_LEGALITY[status]}`);
    }

    // Colour identity only means something once there is a commander, and the
    // commander can never breach the identity it defines.
    if (!identity || line.card_id === deck.commander_id) return;
    const outside = (card.color_identity || [])
      .filter((colour) => !identity.has(colour));
    if (outside.length) {
      note(line.card_id,
        `${lineName(line)} is ${identityLabel(outside)} — outside ` +
        `${commander.name}'s ${identityLabel([...identity])} identity`);
    }
  });
  return problems;
}

function renderDeckPanel() {
  const deck = deckById(state.deckId);
  if (!deck) return showCollectionView();

  if (document.activeElement !== ui.deckName) ui.deckName.value = deck.name;
  if (document.activeElement !== ui.deckCategory) ui.deckCategory.value = deck.category || "";
  state.problems = deckProblems(deck);
  renderDeckSummary(deck);
  renderDeckStats(deck);
  const proxyCount = deck.cards.filter((line) => line.proxy).length;
  ui.proxyListBtn.hidden = proxyCount === 0;
  ui.proxyListBtn.textContent = `Proxies${proxyCount ? ` · ${proxyCount}` : ""}`;

  const groups = new Map(CATEGORIES.map((c) => [c.key, []]));
  deck.cards.forEach((line) => {
    const entry = state.entryById.get(line.card_id);
    const card = lineCard(line);
    const key = line.zone === "maybeboard" ? "maybeboard"
      : line.card_id === deck.commander_id ? "commander" : cardCategory(card);
    groups.get(key).push({ line, entry, card });
  });
  groups.forEach((items) => items.sort((a, b) => {
    const cmc = (x) => x.card.cmc || 0;
    return cmc(a) - cmc(b)
      || lineName(a.line).localeCompare(lineName(b.line));
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
}

async function renderUnownedPrice(deck) {
  // Invalidate on deck contents, ownership, or day changes. An older request
  // must never overwrite the estimate for a newer selection.
  const key = JSON.stringify([deck.id, new Date().toISOString().slice(0, 10),
    deck.cards.map((line) => [line.card_id, line.quantity, line.zone]),
    state.library.entries.map((entry) => [entry.id, entry.quantity])]);
  if (state.unownedPriceKey === key) return;
  state.unownedPriceKey = key;
  ui.deckUnownedPrice.textContent = "Unowned (cheapest): loading…";
  ui.deckUnownedPrice.title = "Main deck only. Counts owned copies across all printings, including copies in other decks. Cheapest paper USD prices include foil finishes; excludes shipping and tax.";
  try {
    const data = await getJson(`/api/decks/${encodeURIComponent(deck.id)}/unowned-price`);
    if (state.unownedPriceKey !== key) return;
    const partial = data.unpriced_count > 0;
    ui.deckUnownedPrice.textContent = partial && data.unpriced_count === data.missing_count
      ? "Unowned (cheapest): price unavailable"
      : `Unowned (cheapest): ${money(data.value)}${partial ? " + unknown" : ""}`;
    ui.deckUnownedPrice.title += ` ${data.missing_count} missing copies; ${data.unpriced_count} without prices.`;
  } catch {
    if (state.unownedPriceKey !== key) return;
    ui.deckUnownedPrice.textContent = "Unowned (cheapest): unavailable";
    state.unownedPriceKey = null; // Retry on the next render.
  }
}

async function refreshAllPrices() {
  if (ui.refreshAllPricesBtn.disabled) return;
  ui.refreshAllPricesBtn.disabled = true;
  ui.refreshAllPricesBtn.textContent = "Refreshing…";
  ui.settingsPriceStatus.textContent = "Updating all prices. Large collections and decks may take a moment.";
  try {
    const library = await getJson("/api/prices/refresh", { method: "POST" });
    state.unownedPriceKey = null;
    state.priceRefreshChecked = !library.prices_stale;
    applyLibrary(library);
    if (state.card) {
      const fresh = state.entryById.get(state.card.id)?.card ||
        library.decks.flatMap((deck) => deck.cards).find((line) => line.card_id === state.card.id)?.card;
      if (fresh) { state.card = fresh; ui.priceChips.innerHTML = priceChipsHtml(fresh); }
    }
    ui.settingsPriceStatus.textContent = library.prices_stale
      ? "Some prices could not be refreshed. Previous values are kept where available; please try again."
      : `All prices refreshed at ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    ui.settingsPriceStatus.textContent = `Prices could not be refreshed. ${error.message}`;
  } finally {
    ui.refreshAllPricesBtn.disabled = false;
    ui.refreshAllPricesBtn.textContent = "Refresh all prices";
  }
}

function renderDeckSummary(deck) {
  const unique = deck.cards.length;
  const commanderLine = deck.cards.find((line) => line.card_id === deck.commander_id);
  const commander = commanderLine ? { name: lineName(commanderLine) } : null;
  const parts = [`${deck.count} / 100 cards`, `${unique} unique`];
  parts.push(commander ? `led by ${commander.name}` : "no commander set");
  if (deck.maybeboard_count) parts.push(`${deck.maybeboard_count} in maybeboard`);
  ui.deckSummary.textContent = parts.join(" · ");
  ui.deckSummary.classList.toggle("ok", deck.count === 100 && Boolean(commander));
  ui.deckPrice.textContent = `Deck price ${money(deck.value)}`;
  renderUnownedPrice(deck);
  ui.deckPrice.title = deck.maybeboard_count
    ? `Main deck ${money(deck.value)} · Maybeboard ${money(deck.maybeboard_value)}`
    : "Current Scryfall USD market value of the main deck";

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

function stackCardHtml({ line, entry, card }, deck) {
  const id = escapeHtml(line.card_id);
  const isCommander = line.card_id === deck.commander_id;

  const art = imageUrl(card, 0);
  const lead = canBeCommander(card);
  const broken = state.problems.get(line.card_id) || [];
  const tip = [lineName(line), ...broken.map((reason) => "⚠ " + reason)].join("\n");
  return `
    <div class="stack-card${isCommander ? " is-commander" : ""}${broken.length ? " illegal" : ""}${line.proxy ? " proxy" : ""}"
         data-id="${id}" title="${escapeHtml(tip)}">
      ${broken.length ? '<span class="warn" aria-label="Breaks a deck rule">!</span>' : ""}
      <img src="${art ? `/img?u=${encodeURIComponent(art)}` : ""}"
           alt="${escapeHtml(lineName(line))}" loading="lazy">
      ${line.proxy ? '<span class="proxy-mark">Proxy</span>' : ""}
      ${line.quantity > 1 ? `<span class="qty">×${line.quantity}</span>` : ""}
      ${lead ? `<button class="cmd${isCommander ? " on" : ""}" data-cmd="${id}"
         title="${isCommander ? "Not the commander" : "Make this the commander"}">★</button>` : ""}
      ${steppersHtml(line)}
    </div>`;
}

function steppersHtml(line) {
  const entry = state.entryById.get(line.card_id);
  const canAdd = line.proxy || line.zone === "maybeboard" || (entry && entry.available > 0);
  return `
    <div class="steppers">
      <button data-step="down" data-card="${escapeHtml(line.card_id)}" title="Remove one">−</button>
      <span class="n" data-step="n">${line.quantity}</span>
      <button data-step="up" data-card="${escapeHtml(line.card_id)}" title="${
        canAdd ? "Add one more" : "No free copies left"}" ${
        canAdd ? "" : "disabled"}>+</button>
    </div>`;
}

function wireDeckCards() {
  ui.deckGrid.querySelectorAll(".stack-card").forEach((node) => {
    const deck = deckById(state.deckId);
    const line = deck && deck.cards.find((item) => item.card_id === node.dataset.id);
    if (line) {
      node.addEventListener("mouseenter", () => showCardPreview(lineCard(line), node));
      node.addEventListener("mouseleave", hideCardPreview);
    }
    node.addEventListener("click", (event) => {
      if (event.target.dataset.step || event.target.dataset.cmd) return;
      openDeckDetail(state.deckId, node.dataset.id);
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
        () => (next ? `${lineName(deck.cards.find((line) => line.card_id === next))} leads the deck.`
                    : "Commander cleared."));
    });
  });
}

async function searchDeckCard() {
  const name = ui.deckFilter.value.trim();
  if (!name) return;
  // Keep this add tied to the destination selected when the search started.
  const deckId = state.deckId;
  const zone = state.deckZone;
  hideDeckSuggestions();
  try {
    const card = await getJson(`/api/card?name=${encodeURIComponent(name)}`);
    const data = await mutate("/api/decks/add", { deck_id: deckId, card, zone },
      (result) => result.proxy_added
        ? `Proxy added to ${zone === "main" ? "main deck" : "maybeboard"}.`
        : `Added ${card.name} to ${zone === "main" ? "main deck" : "maybeboard"}.`);
    if (data) ui.deckFilter.value = "";
  } catch (error) {
    if (error.suggestions && error.suggestions.length) {
      showDeckSuggestions(error.suggestions);
      setStatus("Choose the card you mean from the matches.", true);
    } else {
      setStatus(error.message, true);
    }
  }
}

function setDeckZone(zone) {
  if (!(["main", "maybeboard"].includes(zone))) return;
  state.deckZone = zone;
  ui.deckZoneBtn.textContent = zone === "main" ? "Main deck" : "Maybeboard";
  ui.deckZonePicker.hidden = true;
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
  settings: () => ui.settingsBtn,
  card: () => ui.navCard,
  collection: () => ui.viewCollectionBtn,
  wishlist: () => ui.wishlistBtn,
  import: () => ui.importBtn,
  decks: () => ui.deckMenuBtn,
};

function showView(panel, navKey) {
  state.navigationRevision = (state.navigationRevision || 0) + 1;
  savePreference("mtg.last-view", JSON.stringify({ view: navKey, deckId: state.deckId }));
  if (navKey !== "settings") el("passwordForm").reset();
  disarmDelete();
  hideCardPreview();
  [ui.cardPanel, ui.collectionPanel, ui.wishlistPanel, ui.deckMenuPanel, ui.deckPanel, ui.importPanel, ui.settingsPanel]
    .forEach((node) => { node.hidden = node !== panel; });
  Object.entries(NAV).forEach(([key, node]) =>
    node().classList.toggle("active", key === navKey));
}

function showSettingsView() {
  syncSettings();
  state.deckId = null;
  state.cardSeq++;
  showView(ui.settingsPanel, "settings");
  ui.settingsCollectionValue.textContent = money(state.library.summary.value);
}

function showCollectionView() {
  state.deckId = null;
  state.cardSeq++;          // drop any card still loading; it must not steal the view
  showView(ui.collectionPanel, "collection");
  renderDeckList();
  renderCollection();
}

function showWishlistView() {
  state.deckId = null;
  state.cardSeq++;
  showView(ui.wishlistPanel, "wishlist");
  renderWishlist();
}

function showCardView() {
  showView(ui.cardPanel, "card");
}

function setDeckCategory() {
  const deck = deckById(state.deckId);
  const category = ui.deckCategory.value.trim();
  if (!deck || category === (deck.category || "")) return;
  mutate("/api/decks/category", { id: state.deckId, category }, () =>
    category ? `Moved to ${category}.` : "Moved to Uncategorized.");
}

function openGoldfish() {
  if (!deckById(state.deckId)) return;
  hideCardPreview();
  ui.goldfishDialog.hidden = false;
  startPractice(deckById(state.deckId));
  el("goldfishCloseBtn").focus();
}

function closeGoldfish() {
  ui.goldfishDialog.hidden = true;
  ui.goldfishHand.innerHTML = "";
  ui.goldfishBtn.focus();
}

function exportDeck() {
  const deck = deckById(state.deckId);
  if (!deck) return;
  const main = deck.cards.filter((line) => line.zone === "main");
  const commander = main.filter((line) => line.card_id === deck.commander_id);
  const cards = main.filter((line) => line.card_id !== deck.commander_id);
  const sortLines = (lines) => [...lines].sort((a, b) => lineName(a).localeCompare(lineName(b)));
  const asLine = (line) => `${line.quantity} ${lineName(line)}`;
  const sections = [`// ${deck.name}`];
  if (commander.length) sections.push("", "Commander", ...sortLines(commander).map(asLine));
  sections.push("", "Deck", ...sortLines(cards).map(asLine));
  const maybeboard = deck.cards.filter((line) => line.zone === "maybeboard");
  if (maybeboard.length) sections.push("", "Maybeboard", ...sortLines(maybeboard).map(asLine));
  openListExport("Copy decklist", sections.join("\n") + "\n",
    "This is ready to paste into the app’s deck importer or another decklist tool.");
}

function wishlistExportText(items) {
  const names = new Map();
  for (const item of items) {
    const name = item.card?.name || item.name;
    if (name && item.quantity > 0) names.set(name, (names.get(name) || 0) + item.quantity);
  }
  return [...names].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, quantity]) => `${quantity} ${name}`).join("\n");
}

function exportWishlist() {
  const text = wishlistExportText(state.library.wishlist || []);
  if (!text) return setStatus("Your wishlist is empty.");
  openListExport("Export wishlist", text + "\n",
    "Copy this quantity-and-name list into another site. Uses the wishlist’s merged quantities; different printings of the same card are combined.");
}

function openListExport(title, text, description) {
  el("deckExportTitle").textContent = title;
  el("deckExportDescription").textContent = description;
  ui.deckExportText.setAttribute("aria-label", title);
  ui.deckExportText.value = text;
  ui.deckExportDialog.hidden = false;
  ui.deckExportText.focus();
  ui.deckExportText.select();
}

async function copyDeckExport() {
  const text = ui.deckExportText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ui.deckExportText.focus();
    ui.deckExportText.select();
    if (!document.execCommand("copy")) {
      setStatus("Select the list and copy it manually.", true);
      return;
    }
  }
  setStatus("List copied to the clipboard.");
}

async function refreshDeckPrices() {
  if (state.priceRefreshChecked) return;
  try {
    const library = await getJson("/api/prices/refresh");
    state.priceRefreshChecked = true;
    applyLibrary(library);
    if (library.prices_stale) setStatus("Could not refresh prices; showing the last cached values.", true);
  } catch {
    // Price refresh is additive: opening a deck must still be immediate offline.
  }
}

function showDeckMenuView() {
  state.deckId = null;
  state.cardSeq++;
  showView(ui.deckMenuPanel, "decks");
  renderDeckList();
}

function openDeck(deckId) {
  state.deckId = deckId;
  state.cardSeq++;          // same here: a slow search must not pull us back
  ui.deckFilter.value = "";
  hideDeckSuggestions();
  showView(ui.deckPanel, "deck");   // the deck's own row in the rail lights up
  renderDeckList();
  renderDeckPanel();
  refreshDeckPrices();
}

/* -------------------------------------------------------------- import */

function showImportView() {
  state.cardSeq++;
  state.deckId = null;
  showView(ui.importPanel, "import");
  renderDeckList();
  ui.importText.focus();
}

/* ------------------------------------------------------ command palette */

function commandChoices() {
  const items = [
    { label: "Open Settings", detail: "Collection value and price refresh", run: showSettingsView },
    { label: "Search cards", detail: "Focus the Scryfall search", run: () => {
      ui.search.focus(); ui.search.select();
    } },
    { label: "Open Collection", detail: "Browse cards you own", run: showCollectionView },
    { label: "Filter Collection", detail: "Open Collection and focus its filter", run: () => {
      showCollectionView(); ui.collectionFilter.focus();
    } },
    { label: "Import cards", detail: "Paste a decklist or CSV", run: showImportView },
    { label: "New deck", detail: "Create an empty deck", run: newDeck },
    { label: "Random card", detail: "Draw a card from Scryfall", run: random },
  ];
  (state.library.decks || []).forEach((deck) => items.push({
    label: `Open deck: ${deck.name}`,
    detail: `${deck.count} cards`,
    run: () => openDeck(deck.id),
  }));
  return items;
}

function renderCommandPalette(resetIndex = false) {
  const query = ui.commandInput.value.trim().toLocaleLowerCase();
  state.commandItems = commandChoices().filter((item) =>
    `${item.label} ${item.detail}`.toLocaleLowerCase().includes(query));
  if (resetIndex) state.commandIndex = 0;
  state.commandIndex = Math.max(0, Math.min(state.commandIndex, state.commandItems.length - 1));
  ui.commandList.innerHTML = state.commandItems.length
    ? state.commandItems.map((item, index) => `
      <li><button class="command-item${index === state.commandIndex ? " active" : ""}"
                  data-command="${index}" role="option" aria-selected="${index === state.commandIndex}">
        <span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.detail)}</small>
      </button></li>`).join("")
    : '<li class="command-empty">No matching commands.</li>';
  ui.commandList.querySelectorAll("[data-command]").forEach((node) => {
    node.addEventListener("click", () => runCommand(Number(node.dataset.command)));
  });
}

function openCommandPalette() {
  hideCardPreview();
  ui.commandPalette.hidden = false;
  ui.commandInput.value = "";
  state.commandIndex = 0;
  renderCommandPalette();
  requestAnimationFrame(() => ui.commandInput.focus());
}

function closeCommandPalette() {
  ui.commandPalette.hidden = true;
  ui.commandInput.value = "";
}

function runCommand(index) {
  const item = state.commandItems[index];
  if (!item) return;
  closeCommandPalette();
  item.run();
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

  deck.cards.filter((line) => line.zone === "main").forEach((line) => {
    const card = lineCard(line);
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
  const commanderLine = deck.cards.find((line) => line.card_id === deck.commander_id);
  const identity = commanderLine ? (lineCard(commanderLine).color_identity || []) : [];
  const typeText = CATEGORIES.filter((category) => !["commander", "maybeboard"].includes(category.key))
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
  if (!ui.goldfishDialog.hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeGoldfish(); }
    if (event.key === "Tab") {
      const buttons = [...ui.goldfishDialog.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")]
        .filter(node => !node.closest("[hidden]"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!ui.goldfishDialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (!ui.deckExportDialog.hidden) {
    if (event.key === "Escape") { event.preventDefault(); ui.deckExportDialog.hidden = true; }
    return;
  }
  if (!ui.cardDetailDialog.hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeCardDetail(); }
    return;
  }
  if (!ui.proxyDialog.hidden) {
    if (event.key === "Escape") { event.preventDefault(); ui.proxyDialog.hidden = true; }
    return;
  }
  if (!ui.deckImportDialog.hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeDeckImportDialog(); }
    return;
  }
  if (!ui.profileImportDialog.hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeProfileImportDialog(); }
    return;
  }
  if (!ui.commandPalette.hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeCommandPalette(); return; }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.commandIndex = Math.min(state.commandIndex + 1, state.commandItems.length - 1);
      renderCommandPalette();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.commandIndex = Math.max(state.commandIndex - 1, 0);
      renderCommandPalette();
      return;
    }
    if (event.key === "Enter") { event.preventDefault(); runCommand(state.commandIndex); }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    ui.search.focus();
    ui.search.select();
    return;
  }
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement || target.isContentEditable;
  if (editing) return;
  if (event.key === "/") {
    event.preventDefault();
    showCollectionView();
    ui.collectionFilter.focus();
  } else if (event.key.toLowerCase() === "g" && !ui.collectionPanel.hidden) {
    setCollectionView("grid");
  } else if (event.key.toLowerCase() === "l" && !ui.collectionPanel.hidden) {
    setCollectionView("list");
  }
});

ui.addBtn.addEventListener("click", addToCollection);
ui.wishlistAddBtn.addEventListener("click", addToWishlist);
ui.removeBtn.addEventListener("click", () => state.card && removeFromCollection(state.card.id));
ui.viewCollectionBtn.addEventListener("click", showCollectionView);
ui.wishlistBtn.addEventListener("click", showWishlistView);
ui.wishlistExportBtn.addEventListener("click", exportWishlist);
ui.openFolderBtn.addEventListener("click", openFolder);
ui.collectionFilter.addEventListener("input", renderCollection);
ui.collectionSort.addEventListener("change", setCollectionSort);
ui.collectionGridBtn.addEventListener("click", () => setCollectionView("grid"));
ui.collectionListBtn.addEventListener("click", () => setCollectionView("list"));
ui.collectionUnusedBtn.addEventListener("click", toggleUnusedCollection);
ui.collectionFiltersBtn.addEventListener("click", toggleCollectionFilters);
ui.collectionFiltersPanel.querySelectorAll("[data-collection-filter]").forEach((button) => {
  button.addEventListener("click", () =>
    setCollectionFilter(button.dataset.collectionFilter, button.dataset.value));
});
ui.exportProfileBtn.addEventListener("click", exportProfile);
ui.importProfileBtn.addEventListener("click", () => ui.profileImportFile.click());
ui.priceHistoryBtn.addEventListener("click", openPriceHistory);
ui.priceHistoryCloseBtn.addEventListener("click", () => { ui.priceHistoryDialog.hidden = true; });
ui.priceHistoryDialog.addEventListener("click", (event) => {
  if (event.target === ui.priceHistoryDialog) ui.priceHistoryDialog.hidden = true;
});
ui.profileImportFile.addEventListener("change", (event) => {
  readProfileFile(event.target.files[0]);
  event.target.value = "";
});
ui.profileMergeBtn.addEventListener("click", () => importProfile("merge"));
ui.profileReplaceBtn.addEventListener("click", () => importProfile("replace"));
ui.profileImportCancelBtn.addEventListener("click", closeProfileImportDialog);
ui.profileImportDialog.addEventListener("click", (event) => {
  if (event.target === ui.profileImportDialog) closeProfileImportDialog();
});
ui.commandInput.addEventListener("input", () => renderCommandPalette(true));
ui.commandPalette.addEventListener("click", (event) => {
  if (event.target === ui.commandPalette) closeCommandPalette();
});

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

ui.addToDeckBtn.addEventListener("click", () => {
  ui.deckPicker.hidden = !ui.deckPicker.hidden;
});
ui.deckMenuBtn.addEventListener("click", showDeckMenuView);
ui.deckMenuNewBtn.addEventListener("click", newDeck);
ui.deckImportBtn.addEventListener("click", openDeckImportDialog);
ui.deckImportCloseBtn.addEventListener("click", closeDeckImportDialog);
ui.deckImportCancelBtn.addEventListener("click", closeDeckImportDialog);
ui.deckImportPreviewBtn.addEventListener("click", previewDeckImport);
ui.deckImportText.addEventListener("input", () => {
  state.deckImportToken = null;
  ui.deckImportReport.hidden = true;
});
ui.deckImportDialog.addEventListener("click", (event) => {
  if (event.target === ui.deckImportDialog) closeDeckImportDialog();
});
ui.deckImportDialog.querySelectorAll("[data-deck-import-mode]").forEach((button) => {
  button.addEventListener("click", () => commitDeckImport(button.dataset.deckImportMode));
});
ui.deleteDeckBtn.addEventListener("click", deleteDeck);
ui.deckExportBtn.addEventListener("click", exportDeck);
ui.goldfishBtn.addEventListener("click", openGoldfish);
el("goldfishCloseBtn").addEventListener("click", closeGoldfish);
el("goldfishDoneBtn").addEventListener("click", closeGoldfish);
ui.goldfishDialog.addEventListener("click", (event) => {
  if (event.target === ui.goldfishDialog) closeGoldfish();
});
ui.deckCopyBtn.addEventListener("click", copyDeckExport);
ui.deckExportCloseBtn.addEventListener("click", () => { ui.deckExportDialog.hidden = true; });
ui.deckExportCancelBtn.addEventListener("click", () => { ui.deckExportDialog.hidden = true; });
ui.deckExportDialog.addEventListener("click", (event) => {
  if (event.target === ui.deckExportDialog) ui.deckExportDialog.hidden = true;
});
ui.proxyListBtn.addEventListener("click", openProxyList);
ui.deckFilter.addEventListener("input", () => {
  scheduleDeckSuggest();
});
ui.deckFilter.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); moveDeckSuggestion(1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); moveDeckSuggestion(-1); }
  else if (event.key === "Enter") {
    event.preventDefault();
    if (state.deckActive >= 0) chooseDeckSuggestion(state.deckSuggestionNames[state.deckActive]);
    else searchDeckCard();
  } else if (event.key === "Escape") hideDeckSuggestions();
});
ui.deckFilter.addEventListener("blur", () => setTimeout(hideDeckSuggestions, 120));
ui.deckSearchBtn.addEventListener("click", searchDeckCard);
ui.deckZoneBtn.addEventListener("click", () => {
  ui.deckZonePicker.hidden = !ui.deckZonePicker.hidden;
});
ui.deckZonePicker.querySelectorAll("[data-zone]").forEach((button) => {
  button.addEventListener("click", () => setDeckZone(button.dataset.zone));
});
ui.detailCloseBtn.addEventListener("click", closeCardDetail);
ui.cardDetailDialog.addEventListener("click", (event) => {
  if (event.target === ui.cardDetailDialog) closeCardDetail();
});
ui.proxyCloseBtn.addEventListener("click", () => { ui.proxyDialog.hidden = true; });
ui.proxyDialog.addEventListener("click", (event) => {
  if (event.target === ui.proxyDialog) ui.proxyDialog.hidden = true;
});
ui.deckName.addEventListener("change", renameDeck);
ui.deckName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.deckName.blur();
  else if (event.key === "Escape") {
    const deck = deckById(state.deckId);
    if (deck) ui.deckName.value = deck.name;
    ui.deckName.blur();
  }
});
ui.deckCategory.addEventListener("change", setDeckCategory);
ui.deckCategory.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.deckCategory.blur();
  else if (event.key === "Escape") {
    const deck = deckById(state.deckId);
    if (deck) ui.deckCategory.value = deck.category || "";
    ui.deckCategory.blur();
  }
});

ui.settingsBtn.addEventListener("click", showSettingsView);
ui.refreshAllPricesBtn.addEventListener("click", refreshAllPrices);
ui.logoutBtn.addEventListener("click", signOut);

initializeSettings();
loadIdentity();
restoreRecent();
startApp();
