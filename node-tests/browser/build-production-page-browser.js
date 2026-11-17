#!/usr/bin/env node
// Builds one self-contained HTML page that runs the REAL Production page (Frontend/Views/Production.html markup and
// Frontend/Assets/Scripts/Production.html script) inside iframes, with google.script.run mocked. Open the output in a
// browser to run the browser-level scenarios; results appear on the page.
//
// Usage: node node-tests/browser/build-production-page-browser.js <output.html>
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const viewMarkup = read('Frontend/Views/Production.html');
// The page script is stored as a <script> block; the builder inlines its body.
const pageScript = read('Frontend/Assets/Scripts/Production.html')
  .replace(/^\s*<script>\s*/, '')
  .replace(/\s*<\/script>\s*$/, '');
const mockScript = read('node-tests/browser/mockGoogleScript.js');
const driverScript = read('node-tests/browser/productionPageDriver.js');
// Every inlined source must be free of a closing script tag, or the page would end early.
for (const [name, source] of [['view markup', viewMarkup], ['page script', pageScript], ['mock', mockScript], ['driver', driverScript]]) {
  if (/<\/script/i.test(source)) throw new Error('The ' + name + ' contains a closing script tag; escape it as <\\/script>.');
}

function build() {
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Production page browser tests</title>\n' +
    '<style>body{font-family:system-ui,sans-serif;margin:16px;} pre{white-space:pre-wrap;}</style>\n</head>\n<body>\n' +
    '<h1>Production page: browser-level tests</h1>\n<p>The real Production page runs in iframes with a mocked server. Results:</p>\n' +
    '<pre id="results">running...</pre>\n' +
    '<script>\nconst PAGE_MARKUP = ' + JSON.stringify(viewMarkup) + ';\n' +
    'const PAGE_SCRIPT = ' + JSON.stringify(pageScript) + ';\n' +
    'const MOCK_SCRIPT = ' + JSON.stringify(mockScript) + ';\n</script>\n' +
    '<script>\n' + driverScript + '\n</script>\n</body>\n</html>\n';
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output) {
    console.error('usage: node node-tests/browser/build-production-page-browser.js <output.html>');
    process.exit(2);
  }
  fs.writeFileSync(output, build(), 'utf8');
  console.log('wrote ' + output);
}

module.exports = { build };
