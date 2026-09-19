// Run with node tests/test_wishlist_ui.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/app.js', 'utf8');
const start = source.indexOf('function cardRecordById(');
const end = source.indexOf('\n/* ------------------------------------------------------------- decking */', start);
assert.ok(start >= 0 && end > start, 'wishlist detail helpers should be present');
assert.match(source, /wireTiles\(ui\.wishlistGrid, \(id\) => openWishlistDetail\(id\)\)/);

let detailCall = null;
let previewHidden = false;
const button = { disabled: false, isConnected: true, addEventListener() {} };
const context = {
  state: {
    entryById: new Map([['owned', { id: 'owned', card: { name: 'Owned card' } }]]),
    library: {
      wishlist: [{
        id: 'wanted', name: 'Wanted card', card: { name: 'Wanted card' },
        quantity: 2, manual_quantity: 2, proxy_quantity: 0,
      }],
    },
  },
  ui: {
    detailActions: {
      innerHTML: '',
      querySelector(selector) {
        return selector === '[data-detail-remove-wish]' && this.innerHTML.includes('data-detail-remove-wish')
          ? button : null;
      },
    },
  },
  hideCardPreview() { previewHidden = true; },
  detailBase(...args) { detailCall = args; },
  removeFromWishlist: async () => ({}),
  closeCardDetail() {},
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

assert.equal(context.cardRecordById('owned').card.name, 'Owned card');
assert.equal(context.cardRecordById('wanted').card.name, 'Wanted card');
assert.equal(context.cardRecordById('missing'), undefined);

context.openWishlistDetail('wanted');
assert.equal(previewHidden, true);
assert.equal(detailCall[0].name, 'Wanted card');
assert.equal(detailCall[1], 'Wishlist card');
assert.match(detailCall[2], /2 needed/);
assert.match(context.ui.detailActions.innerHTML, /Remove one wish/);

console.log('Wishlist popup checks passed.');
