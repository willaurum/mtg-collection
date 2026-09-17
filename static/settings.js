/* Settings share the app's existing preference storage and action handlers. */
function jsonPreference(key, fallback) {
  try { return JSON.parse(readPreference(key, "null")) || fallback; }
  catch { return fallback; }
}

function applyAppearance() {
  const theme = readPreference("mtg.theme", "dark");
  document.documentElement.dataset.theme = ["dark", "light", "eli"].includes(theme) ? theme : "dark";
  const scales = { small: "0.9", normal: "1", large: "1.2" };
  document.documentElement.style.setProperty("--text-scale", scales[readPreference("mtg.text-size", "normal")] || "1");
  document.documentElement.classList.toggle("compact", readPreference("mtg.compact", "0") === "1");
}

function persistCollectionFilters() {
  if (readPreference("mtg.remember-filters", "0") !== "1") return;
  savePreference("mtg.collection-filters", JSON.stringify({
    ...state.collectionFilters, colors: [...state.collectionFilters.colors],
    search: ui.collectionFilter.value, unused: state.unusedOnly,
  }));
}

function restoreCollectionFilters() {
  state.unusedOnly = false;
  if (readPreference("mtg.remember-filters", "0") !== "1") return;
  const saved = jsonPreference("mtg.collection-filters", {});
  for (const kind of ["availability", "type", "rarity"]) {
    const allowed = [...ui.collectionFiltersPanel.querySelectorAll(`[data-collection-filter="${kind}"]`)]
      .map((button) => button.dataset.value);
    if (allowed.includes(saved[kind])) state.collectionFilters[kind] = saved[kind];
  }
  const colors = Array.isArray(saved.colors) ? saved.colors : [];
  state.collectionFilters.colors = new Set(colors.filter((color) => ["W", "U", "B", "R", "G", "colorless"].includes(color)));
  ui.collectionFilter.value = typeof saved.search === "string" ? saved.search : "";
  state.unusedOnly = saved.unused === true;
}

function syncSettings() {
  el("settingTheme").value = readPreference("mtg.theme", "dark");
  el("settingTextSize").value = readPreference("mtg.text-size", "normal");
  el("settingCompact").checked = readPreference("mtg.compact", "0") === "1";
  el("settingStartup").value = readPreference("mtg.startup", "collection");
  el("settingCollectionView").value = state.collectionView;
  el("settingCollectionSort").value = state.collectionSort;
  el("settingRememberFilters").checked = readPreference("mtg.remember-filters", "0") === "1";
  el("settingBackup").value = readPreference("mtg.backup-days", "off");
  const last = Number(readPreference("mtg.last-backup", "0"));
  el("backupStatus").textContent = last > 0
    ? `Last profile export: ${new Date(last).toLocaleString()}.`
    : "No profile export recorded on this device.";
}

function recordBackup() {
  savePreference("mtg.last-backup", String(Date.now()));
  savePreference("mtg.backup-snooze", "0");
  syncSettings();
  checkBackupReminder();
}

function checkBackupReminder() {
  const days = Number(readPreference("mtg.backup-days", "off"));
  const last = Number(readPreference("mtg.last-backup", "0"));
  const snooze = Number(readPreference("mtg.backup-snooze", "0"));
  el("backupReminder").hidden = !([7, 30].includes(days) && Date.now() >= snooze &&
    (!last || Date.now() - last >= days * 86400000));
}

function configureAccountSettings(me) {
  el("settingsAccountName").textContent = me.user ? `Signed in as ${me.user}` : "Not signed in.";
  el("settingsLocalAccount").hidden = !me.local;
  el("passwordForm").hidden = Boolean(me.local || !me.auth);
  el("settingsSignOut").hidden = Boolean(me.local || !me.auth);
}

async function changePassword(event) {
  event.preventDefault();
  const status = el("passwordStatus");
  if (el("newPassword").value !== el("confirmPassword").value) {
    status.textContent = "New passwords do not match.";
    return;
  }
  const button = el("changePasswordBtn");
  button.disabled = true;
  status.textContent = "Updating password…";
  try {
    await getJson("/api/account/password", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: el("currentPassword").value, new_password: el("newPassword").value }),
    });
    el("passwordForm").reset();
    status.textContent = "Password changed.";
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; }
}

async function clearCachedImages() {
  const button = el("settingsClearImages");
  if (button.disabled) return;
  button.disabled = true;
  el("cacheStatus").textContent = "Clearing downloaded images…";
  try {
    const result = await getJson("/api/cache/images/clear", { method: "POST" });
    el("cacheStatus").textContent = `Cleared ${result.removed} cached images. They will download again when needed.`;
  } catch (error) { el("cacheStatus").textContent = error.message; }
  finally { button.disabled = false; }
}

function initializeSettings() {
  el("settingCollectionSort").innerHTML = ui.collectionSort.innerHTML;
  restoreCollectionFilters();
  applyAppearance();
  syncSettings();
  for (const [id, key] of [["settingTheme", "mtg.theme"], ["settingTextSize", "mtg.text-size"],
    ["settingStartup", "mtg.startup"], ["settingBackup", "mtg.backup-days"]]) {
    el(id).addEventListener("change", () => {
      savePreference(key, el(id).value);
      applyAppearance();
      checkBackupReminder();
    });
  }
  el("settingCompact").addEventListener("change", () => {
    savePreference("mtg.compact", el("settingCompact").checked ? "1" : "0");
    applyAppearance();
  });
  el("settingCollectionView").addEventListener("change", () => setCollectionView(el("settingCollectionView").value));
  el("settingCollectionSort").addEventListener("change", () => {
    ui.collectionSort.value = el("settingCollectionSort").value;
    setCollectionSort();
  });
  el("settingRememberFilters").addEventListener("change", () => {
    const remember = el("settingRememberFilters").checked;
    savePreference("mtg.remember-filters", remember ? "1" : "0");
    if (remember) persistCollectionFilters();
    else savePreference("mtg.collection-filters", "{}");
  });
  el("settingsExport").addEventListener("click", exportProfile);
  el("settingsImport").addEventListener("click", () => ui.profileImportFile.click());
  el("backupNow").addEventListener("click", exportProfile);
  el("backupDismiss").addEventListener("click", () => {
    savePreference("mtg.backup-snooze", String(Date.now() + 86400000));
    checkBackupReminder();
  });
  el("settingsClearImages").addEventListener("click", clearCachedImages);
  el("passwordForm").addEventListener("submit", changePassword);
  el("settingsSignOut").addEventListener("click", signOut);
  checkBackupReminder();
  setInterval(checkBackupReminder, 3600000);
}

async function startApp() {
  const startup = readPreference("mtg.startup", "collection");
  const last = jsonPreference("mtg.last-view", { view: "collection" });
  showCollectionView();
  const revision = state.navigationRevision;
  await loadLibrary();
  if (state.navigationRevision !== revision) return; // Respect navigation during loading.
  const target = startup === "last" ? last : { view: startup };
  if (target.view === "decks") showDeckMenuView();
  else if (target.view === "wishlist") showWishlistView();
  else if (target.view === "deck" && deckById(target.deckId)) openDeck(target.deckId);
  else if (target.view === "settings") showSettingsView();
  else if (target.view === "import") showImportView();
  else if (target.view === "card") {
    if (state.recent.length) showCard(state.recent[0]);
    else showCardView();
  }
}
