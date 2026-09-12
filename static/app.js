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

const SUGGEST_DELAY = 220;
const RECENT_MAX = 12;
const RECENT_KEY = "mtg.recent";

const el = (id) => document.getElementById(id);
const ui = {
  search: el("search"), suggestions: el("suggestions"), searchBtn: el("searchBtn"),
  randomBtn: el("randomBtn"), scryfallBtn: el("scryfallBtn"), status: el("status"),
  recent: el("recent"), recentEmpty: el("recentEmpty"),
  art: el("cardArt"), artPlaceholder: el("artPlaceholder"), flipBtn: el("flipBtn"),
  name: el("cardName"), mana: el("manaCost"), type: el("typeLine"), pt: el("pt"),
  rules: el("rules"), rarityDot: el("rarityDot"), setLine: el("setLine"),
  artist: el("artistLine"), priceChips: el("priceChips"), legalChips: el("legalChips"),
  printings: el("printings"), scryfallCredit: el("scryfallCredit"),
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

function setStatus(message, isError) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", Boolean(isError));
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.suggestions = payload.suggestions || [];
    throw error;
  }
  return payload;
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

/* ------------------------------------------------------------- actions */

async function showCard(card, refreshPrintings = true) {
  state.card = card;
  state.face = 0;
  renderCard(card);
  setStatus(`${card.name} · ${card.set_name}`);
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

async function load(url, busy) {
  setStatus(busy);
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
  }
}

function search() {
  const name = ui.search.value.trim();
  if (!name) return setStatus("Type a card name first.", true);
  load(`/api/card?name=${encodeURIComponent(name)}`, `Searching for "${name}"…`);
}

const random = () => {
  hideSuggestions();
  load("/api/random", "Drawing a random card…");
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

ui.searchBtn.addEventListener("click", search);
ui.randomBtn.addEventListener("click", random);
ui.flipBtn.addEventListener("click", flip);
ui.scryfallBtn.addEventListener("click", openScryfall);
ui.scryfallCredit.addEventListener("click", openScryfall);
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

restoreRecent();
random();
