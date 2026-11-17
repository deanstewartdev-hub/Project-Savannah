#!/usr/bin/env node
'use strict';
// Static, read-only dependency map of the Apps Script side: which pushed file references which
// other file's top-level names. Prints file-level strongly connected components (cycles) and a
// directory-level edge list. Heuristic (identifier match, comments and strings stripped); it is an
// audit aid, not a build step. Usage: node tools/refactor/dependency-map.cjs [--json]
const fs = require('node:fs');
const path = require('node:path');
const { pushedServerFiles, topLevelDeclarations, root } = require('../../node-tests/lib/appsScriptGlobalScope.cjs');

const files = pushedServerFiles().filter(f => !/^Tests\//.test(f));
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
const owner = new Map();
const sources = {};
for (const f of files) {
  const raw = fs.readFileSync(path.join(root, f), 'utf8');
  sources[f] = strip(raw);
  for (const d of topLevelDeclarations(raw)) if (!owner.has(d.name)) owner.set(d.name, f);
}
const edges = new Map(files.map(f => [f, new Set()]));
for (const f of files) {
  for (const [name, o] of owner) {
    if (o === f) continue;
    const pattern = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
    if (pattern.test(sources[f])) edges.get(f).add(o);
  }
}

// Tarjan strongly connected components.
let counter = 0;
const stack = [];
const meta = new Map();
const cycles = [];
function visit(v) {
  meta.set(v, { index: counter, low: counter, onStack: true });
  counter++;
  stack.push(v);
  for (const w of edges.get(v)) {
    if (!meta.has(w)) { visit(w); meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).low); }
    else if (meta.get(w).onStack) meta.get(v).low = Math.min(meta.get(v).low, meta.get(w).index);
  }
  if (meta.get(v).low === meta.get(v).index) {
    const component = [];
    let w;
    do { w = stack.pop(); meta.get(w).onStack = false; component.push(w); } while (w !== v);
    if (component.length > 1) cycles.push(component.sort());
  }
}
for (const f of files) if (!meta.has(f)) visit(f);

const dir = f => (f.includes('/') ? f.split('/')[0] : '(root)');
const dirEdges = new Map();
for (const [f, set] of edges) {
  for (const t of set) {
    if (dir(f) === dir(t)) continue;
    const key = dir(f) + ' -> ' + dir(t);
    dirEdges.set(key, (dirEdges.get(key) || 0) + 1);
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    files: files.length,
    fileCycles: cycles,
    directoryEdges: Object.fromEntries([...dirEdges].sort()),
    fileEdges: Object.fromEntries([...edges].map(([f, s]) => [f, [...s].sort()]))
  }, null, 1));
} else {
  console.log(files.length + ' non-test pushed files');
  console.log('File-level cycles (' + cycles.length + '):');
  for (const c of cycles) console.log('  - ' + c.join(', '));
  console.log('Directory edges (count of file-to-file references):');
  for (const [k, v] of [...dirEdges].sort()) console.log('  ' + k + '  [' + v + ']');
}
