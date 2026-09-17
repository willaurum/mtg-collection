// Run with node tests/test_wishlist_export.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
const start = source.indexOf('function wishlistExportText(');
const end = source.indexOf('\nfunction exportWishlist(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
assert.equal(context.wishlistExportText([]), '');
assert.equal(context.wishlistExportText([
  {name: 'Sol Ring', quantity: 1},
  {card: {name: 'Lightning Bolt'}, quantity: 3, manual_quantity: 2, proxy_quantity: 3},
  {card: {name: 'Lightning Bolt'}, quantity: 2},
  {card: {name: 'Fire // Ice'}, quantity: 1},
]), '1 Fire // Ice\n5 Lightning Bolt\n1 Sol Ring');
console.log('Wishlist export checks passed.');
