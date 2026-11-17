'use strict';

// Offline model of Google Apps Script's shared global scope.
//
// Apps Script concatenates every pushed server file into ONE global scope and runs each file's
// top-level code once, in push order. This helper reproduces that: it loads every pushed server
// file into a single vm context (in a chosen order) against inert stand-ins for the Google
// services, and reports what the scope exposes. It never touches Google, the network or any data.
//
// Which files are "pushed" is taken from the repository's own .claspignore, so the model follows
// the deployment rules instead of a second hand-kept list.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');

// Inert stand-in for any Google service object: every property is another stand-in and every call
// returns one. It records nothing and performs no I/O. A file that needs real behaviour at LOAD time
// would surface here as a failure, which is exactly the order-sensitivity this model exists to catch.
function inertService(name) {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      return inertService(`${name}.${String(prop)}`);
    },
    apply() { return inertService(`${name}()`); },
    construct() { return inertService(`new ${name}`); }
  });
}

const GOOGLE_SERVICES = [
  'Logger', 'YouTube', 'PropertiesService', 'SpreadsheetApp', 'UrlFetchApp', 'Sheets', 'ScriptApp',
  'DriveApp', 'LockService', 'ContentService', 'CacheService', 'HtmlService', 'Session', 'Drive'
];

// Pushed server files: the entries .claspignore re-includes, minus HTML (client templates).
function pushedServerFiles() {
  const lines = fs.readFileSync(path.join(root, '.claspignore'), 'utf8').split(/\r?\n/).map(s => s.trim());
  const includes = lines.filter(l => l.startsWith('!')).map(l => l.slice(1));
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(js|gs)$/.test(entry.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const pattern of includes) {
    if (pattern.endsWith('/**')) {
      const dir = path.join(root, pattern.slice(0, -3));
      if (fs.existsSync(dir)) walk(dir);
    } else if (/\.(js|gs)$/.test(pattern) && fs.existsSync(path.join(root, pattern))) {
      out.push(pattern);
    }
  }
  return [...new Set(out)].sort();
}

// Column-0 declarations are the file's top-level (the codebase indents everything nested).
function topLevelDeclarations(source) {
  const found = [];
  const pattern = /^(function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = pattern.exec(source))) found.push({ kind: m[1].replace('*', ''), name: m[2] });
  return found;
}

function loadScope(files) {
  const sandbox = {
    Utilities: { getUuid: randomUUID, sleep() {}, formatDate: () => '', base64Encode: () => '', computeDigest: () => [], newBlob: () => ({}), DigestAlgorithm: {}, Charset: {} },
    console
  };
  for (const name of GOOGLE_SERVICES) sandbox[name] = inertService(name);
  const context = vm.createContext(sandbox);
  const failures = [];
  for (const file of files) {
    try {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file, timeout: 10000 });
    } catch (error) {
      failures.push({ file, error: String(error && error.message || error) });
    }
  }
  return { context, failures };
}

// What a name looks like from outside: its type and, for objects, its public member names.
function describeGlobal(context, name) {
  try {
    const type = vm.runInContext(`typeof ${name}`, context);
    if (type === 'undefined') return null;
    if (type === 'function' || type === 'object') {
      const keys = vm.runInContext(
        `(function(){ try { var v = ${name}; return v && (typeof v === 'object' || typeof v === 'function') ? Object.keys(v).sort() : null; } catch (e) { return null; } })()`,
        context
      );
      return { type, keys: keys || undefined };
    }
    return { type };
  } catch (_error) {
    return null;
  }
}

module.exports = { root, pushedServerFiles, topLevelDeclarations, loadScope, describeGlobal };
