// Run with node tests/test_desktop_image_routing.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/app.js', 'utf8');
const startup = source.indexOf('\nlet appStarted = false;');
assert.ok(startup > 0);

const listeners = {};
let starts = 0;
const context = {
  window: {
    pywebview: null,
    addEventListener(name, handler) { listeners[name] = handler; },
  },
  document: {
    addEventListener() {},
    querySelectorAll() { return []; },
  },
  setTimeout() {},
  startApp() { starts++; },
  encodeURIComponent,
};
vm.createContext(context);
vm.runInContext(source.slice(0, source.indexOf('\nconst FORMATS')) + source.slice(startup), context);

(async () => {
  assert.equal(typeof listeners.pywebviewready, 'function');
  context.window.pywebview = { api: { image_cache_base: async () => 'http://127.0.0.1:12345' } };
  await listeners.pywebviewready();
  assert.equal(context.imageSrc('https://cards.scryfall.io/test.jpg'),
    'http://127.0.0.1:12345/img?u=https%3A%2F%2Fcards.scryfall.io%2Ftest.jpg');
  assert.equal(starts, 1);
  console.log('Desktop image routing checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
