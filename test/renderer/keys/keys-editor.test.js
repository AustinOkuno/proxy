import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKeyRows, checkBinding, keymapPatch, resetAllPatch, filterRows,
} from '../../../src/renderer/keys/keys-editor.js';
import { DEFAULT_KEYMAP } from '../../../src/renderer/keys/keymap.js';

const row = (rows, id) => rows.find((r) => r.id === id);

test('every default command gets a row, even before it is registered', () => {
  const rows = buildKeyRows([], {}, {});
  for (const id of Object.keys(DEFAULT_KEYMAP)) assert.ok(row(rows, id), id);
  assert.equal(row(rows, 'app.commandBar').keys, 'Ctrl+K');
  assert.equal(row(rows, 'reply.toggleExplanation').title, 'Collapse or expand explanations');
  assert.ok(rows.every((r) => !r.changed && !r.clashes.length));
});

test('registered commands use their own title and group; focusInput is left out', () => {
  const rows = buildKeyRows([
    { id: 'chat.new', title: 'Start a new chat', group: 'Chat' },
    { id: 'theme.neon-night', title: 'Theme: Neon Night', group: 'Theme' },
    { id: 'chat.focusInput', title: 'Focus the message box', group: 'Chat' },
  ], {}, {});
  assert.equal(row(rows, 'chat.new').title, 'Start a new chat');
  assert.equal(row(rows, 'theme.neon-night').keys, '');
  assert.equal(row(rows, 'chat.focusInput'), undefined);
});

test('rows are grouped in a fixed order', () => {
  const groups = [...new Set(buildKeyRows([], {}, {}).map((r) => r.group))];
  assert.deepEqual(groups, ['App', 'Chat', 'Reply', 'History', 'Panel', 'Theme']);
});

test('overrides show as changed, and clashes are found both ways', () => {
  const rows = buildKeyRows([], { 'chat.new': 'ctrl+k', 'theme.next': '' }, {});
  const n = row(rows, 'chat.new');
  assert.equal(n.keys, 'Ctrl+K');
  assert.equal(n.changed, true);
  assert.deepEqual(n.clashes, ['Open the command bar']);
  assert.deepEqual(row(rows, 'app.commandBar').clashes, ['New chat']);
  assert.equal(row(rows, 'theme.next').keys, '');
  assert.equal(row(rows, 'theme.next').changed, true);
});

test('a shortcut that a global hotkey also uses is flagged', () => {
  const rows = buildKeyRows([], { 'chat.new': 'Ctrl+Alt+S' }, { regionSnip: 'Ctrl+Alt+S', togglePanel: '' });
  assert.equal(row(rows, 'chat.new').globalClash, 'Region snip');
  assert.equal(row(rows, 'app.commandBar').globalClash, '');
});

test('checkBinding refuses fixed keys and notes plain keys', () => {
  assert.deepEqual(checkBinding('ctrl+j'), { ok: true, value: 'Ctrl+J', note: '' });
  assert.equal(checkBinding('Enter').ok, false);
  assert.equal(checkBinding('Shift+Tab').ok, false);
  assert.equal(checkBinding('Ctrl+Banana').ok, false);
  const plain = checkBinding('J');
  assert.equal(plain.ok, true);
  assert.match(plain.note, /not typing/);
  assert.equal(checkBinding('F5').note, '');
});

test('keymapPatch sends null for the default and keeps real overrides', () => {
  assert.deepEqual(keymapPatch('app.commandBar', 'ctrl+k'), { 'app.commandBar': null });
  assert.deepEqual(keymapPatch('app.commandBar', 'Ctrl+J'), { 'app.commandBar': 'Ctrl+J' });
  assert.deepEqual(keymapPatch('app.commandBar', ''), { 'app.commandBar': '' });
  assert.deepEqual(keymapPatch('theme.studio', ''), { 'theme.studio': null });
  assert.deepEqual(keymapPatch('theme.studio', 'Alt+S'), { 'theme.studio': 'Alt+S' });
});

test('resetAllPatch clears every override', () => {
  assert.deepEqual(resetAllPatch({ a: 'Ctrl+J', b: '' }), { a: null, b: null });
  assert.deepEqual(resetAllPatch(undefined), {});
});

test('filterRows matches titles, groups and keys in any word order', () => {
  const rows = buildKeyRows([], {}, {});
  assert.deepEqual(filterRows(rows, 'dock top').map((r) => r.id).sort(), ['panel.dock.top-left', 'panel.dock.top-right']);
  assert.deepEqual(filterRows(rows, 'ctrl+e').map((r) => r.id), ['reply.toggleExplanation']);
  assert.equal(filterRows(rows, '').length, rows.length);
});
