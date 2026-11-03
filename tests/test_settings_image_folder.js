// Run with node tests/test_settings_image_folder.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const controls = Object.fromEntries(
  ['settingsClearImages', 'cacheDescription', 'cacheStatus'].map((id) => [id, {
    textContent: '', disabled: false,
  }]));
let serverCalls = 0;
const context = {
  window: { pywebview: { api: {
    open_image_folder: async () => ({ ok: true, path: 'C:\\cache\\images' }),
  } } },
  el: (id) => controls[id],
  getJson: async () => { serverCalls++; return { removed: 2 }; },
  Error,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/settings.js', 'utf8'), context);

(async () => {
  context.configureImageCacheSettings();
  assert.equal(controls.settingsClearImages.textContent, 'Open image folder');
  await context.manageCachedImages();
  assert.equal(controls.cacheStatus.textContent, 'Opened C:\\cache\\images.');
  assert.equal(serverCalls, 0, 'desktop must not clear the shared server cache');

  context.window.pywebview = null;
  await context.manageCachedImages();
  assert.equal(serverCalls, 1, 'regular browser should retain its server cache action');
  console.log('Settings image folder checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
