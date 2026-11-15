import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, filterItems } from '../../../src/renderer/keys/fuzzy.js';

test('fuzzyScore needs every character in order, ignoring case and spaces', () => {
  assert.notEqual(fuzzyScore('nc', 'New chat'), null);
  assert.notEqual(fuzzyScore('NEW CH', 'New chat'), null);
  assert.equal(fuzzyScore('cn', 'New chat'), null);
  assert.equal(fuzzyScore('xyz', 'New chat'), null);
  assert.equal(fuzzyScore('', 'anything'), 0);
});

test('word starts and runs score higher than scattered letters', () => {
  assert.ok(fuzzyScore('neon', 'Theme: Neon Night') > fuzzyScore('neon', 'Open the settings now'));
  assert.ok(fuzzyScore('dock', 'Dock the panel top left') > fuzzyScore('dock', 'Did our clock keep'));
});

const items = [
  { id: 'chat.new', title: 'New chat', group: 'Chat' },
  { id: 'theme.neon-night', title: 'Theme: Neon Night', group: 'Theme' },
  { id: 'panel.dock.top-left', title: 'Dock the panel top left', group: 'Panel' },
  { id: 'panel.dock.top-right', title: 'Dock the panel top right', group: 'Panel' },
  { id: 'app.settings', title: 'Open settings', group: 'App' },
];

test('filterItems: empty query keeps everything in order', () => {
  assert.deepEqual(filterItems('', items), items);
  assert.deepEqual(filterItems('   ', items), items);
});

test('filterItems: "neon" finds the theme first; "dock tr" finds top right', () => {
  assert.equal(filterItems('neon', items)[0].id, 'theme.neon-night');
  assert.equal(filterItems('dock top right', items)[0].id, 'panel.dock.top-right');
  assert.deepEqual(filterItems('zzz', items), []);
});

test('filterItems also matches the group and id', () => {
  assert.deepEqual(filterItems('panel', items).map((i) => i.id).slice(0, 2), ['panel.dock.top-left', 'panel.dock.top-right']);
});
