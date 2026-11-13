// Run with node tests/test_color_filters.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/app.js', 'utf8');
const start = source.indexOf('function matchesColorFilter(');
const end = source.indexOf('\nfunction renderCollection(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const matches = context.matchesColorFilter;

const white = {color_identity: ['W']};
const blue = {color_identity: ['U']};
const azorius = {color_identity: ['W', 'U']};
const colorless = {color_identity: []};
const both = new Set(['W', 'U']);
assert.equal(matches(white, both, 'or'), true);
assert.equal(matches(blue, both, 'or'), true);
assert.equal(matches(azorius, both, 'or'), true);
assert.equal(matches(white, both, 'and'), false);
assert.equal(matches(azorius, both, 'and'), true);
assert.equal(matches(colorless, new Set(['colorless']), 'or'), true);
assert.equal(matches(colorless, new Set(['colorless', 'W']), 'or'), true);
assert.equal(matches(white, new Set(['colorless', 'W']), 'and'), false);
assert.equal(matches(white, new Set(), 'and'), true);
console.log('Color filter AND/OR checks passed.');
