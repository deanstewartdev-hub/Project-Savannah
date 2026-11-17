'use strict';
// The browser-level harness for the Production page must build from the real sources, and each inline script must parse.
// The scenarios themselves run in a browser (node node-tests/browser/build-production-page-browser.js <out.html>, then open
// the file through a local server); this check keeps the build from silently breaking in the offline run.
const assert = require('node:assert/strict');
const { build } = require('./browser/build-production-page-browser.js');

const html = build();
assert.ok(html.includes('id="results"'), 'the results panel is present');
assert.ok(html.includes('const PAGE_MARKUP ='), 'the real page markup is embedded');
assert.ok(html.includes('production-workspace'), 'the page root is embedded');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(blocks.length, 2, 'the constants block and the driver block');
for (const block of blocks) new Function(block[1]); // throws if an inline script does not parse
console.log('Production page browser harness: built, ' + blocks.length + ' inline scripts parse.');
