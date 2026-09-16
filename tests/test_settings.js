// Run with node tests/test_settings.js. No DOM/network dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const prefs = new Map();
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, {value: '', textContent: '', hidden: true});
  return elements.get(id);
};
const state = {navigationRevision: 0, deckId: null, recent: [], collectionFilters: {
  availability: 'all', type: 'all', rarity: 'all', colors: new Set()}, unusedOnly: false};
let currentView;
let resolveLibrary;
const ui = {collectionFilter: el('filter'), collectionFiltersPanel: {
  querySelectorAll: () => ['all', 'free', 'creature', 'rare'].map(value => ({dataset: {value}}))}};
const context = vm.createContext({state, ui, el, Date, Set, JSON, Number,
  readPreference: (key, fallback) => prefs.get(key) || fallback,
  savePreference: (key, value) => prefs.set(key, value),
  showCollectionView: () => {currentView = 'collection'; state.navigationRevision++;},
  showDeckMenuView: () => {currentView = 'decks';},
  showImportView: () => {currentView = 'import';},
  deckById: id => id === 'valid', openDeck: id => {currentView = id;},
  loadLibrary: () => new Promise(resolve => {resolveLibrary = resolve;}),
});
vm.runInContext(fs.readFileSync('static/settings.js', 'utf8'), context);
(async () => {
  prefs.set('mtg.startup', 'decks');
  let ready = context.startApp(); resolveLibrary(); await ready;
  assert.equal(currentView, 'decks');
  prefs.set('mtg.startup', 'last');
  prefs.set('mtg.last-view', JSON.stringify({view: 'deck', deckId: 'valid'}));
  ready = context.startApp(); resolveLibrary(); await ready;
  assert.equal(currentView, 'valid');
  prefs.set('mtg.last-view', JSON.stringify({view: 'deck', deckId: 'deleted'}));
  ready = context.startApp(); resolveLibrary(); await ready;
  assert.equal(currentView, 'collection');
  prefs.set('mtg.startup', 'decks');
  ready = context.startApp(); state.navigationRevision++; currentView = 'settings'; resolveLibrary(); await ready;
  assert.equal(currentView, 'settings');
  prefs.set('mtg.remember-filters', '1');
  state.collectionFilters.colors = new Set(['W', 'U']);
  state.collectionFilters.type = 'creature';
  ui.collectionFilter.value = 'flying';
  state.unusedOnly = true;
  context.persistCollectionFilters();
  state.collectionFilters.colors.clear(); ui.collectionFilter.value = '';
  context.restoreCollectionFilters();
  assert.deepEqual([...state.collectionFilters.colors], ['W', 'U']);
  assert.equal(ui.collectionFilter.value, 'flying');
  assert.equal(state.unusedOnly, true);
  prefs.set('mtg.backup-days', '7');
  context.checkBackupReminder(); assert.equal(el('backupReminder').hidden, false);
  prefs.set('mtg.last-backup', String(Date.now()));
  context.checkBackupReminder(); assert.equal(el('backupReminder').hidden, true);
  prefs.set('mtg.last-backup', '0'); prefs.set('mtg.backup-snooze', String(Date.now() + 86400000));
  context.checkBackupReminder(); assert.equal(el('backupReminder').hidden, true);
  console.log('Settings checks passed: startup, navigation races, remembered filters, backup reminders.');
})().catch(error => {console.error(error); process.exitCode = 1;});
