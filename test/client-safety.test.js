'use strict';
// Apps Script served "https://..." inside client JS truncated at "//" (SyntaxError in production, 2026-11-25).
// Keep literal double slashes out of client scripts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'client');

test('client scripts contain no "://" literal', () => {
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js.html'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      assert.ok(!line.includes('://'), `${f}:${i + 1} has "://" — escape as ":\\/\\/"`);
    });
  }
});

test('client scripts parse as JavaScript', () => {
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js.html'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
    assert.doesNotThrow(() => new Function(src), `${f} has a syntax error`);
  }
});

test('client scripts still parse if every "//" to end of line is stripped', () => {
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js.html'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert.doesNotThrow(() => new Function(src), `${f} breaks when line comments are stripped`);
  }
});
