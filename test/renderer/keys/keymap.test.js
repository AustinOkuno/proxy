import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEYMAP, normalizeAccelerator, eventAccelerator, resolveKeymap, buildLookup, findConflicts,
  isReserved, worksWhileTyping,
} from '../../../src/renderer/keys/keymap.js';

const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('normalizeAccelerator gives one spelling per shortcut', () => {
  assert.equal(normalizeAccelerator('ctrl+k'), 'Ctrl+K');
  assert.equal(normalizeAccelerator('Shift+Control+c'), 'Ctrl+Shift+C');
  assert.equal(normalizeAccelerator('CmdOrCtrl+Shift+c'), 'Ctrl+Shift+C');
  assert.equal(normalizeAccelerator('Meta+Alt+x'), 'Alt+Super+X');
  assert.equal(normalizeAccelerator('Ctrl+Return'), 'Ctrl+Enter');
  assert.equal(normalizeAccelerator('Ctrl+,'), 'Ctrl+,');
  assert.equal(normalizeAccelerator('Ctrl++'), 'Ctrl+Plus');
  assert.equal(normalizeAccelerator(''), '');
  assert.equal(normalizeAccelerator('Ctrl+Banana'), '');
  assert.equal(normalizeAccelerator(undefined), '');
});

test('eventAccelerator matches the default keymap for every 9.6 shortcut', () => {
  const lookup = buildLookup(resolveKeymap({}));
  const cases = [
    [ev('KeyK', { ctrlKey: true }), 'app.commandBar'],
    [ev('KeyN', { ctrlKey: true }), 'chat.new'],
    [ev('Tab', { ctrlKey: true }), 'chat.next'],
    [ev('Tab', { ctrlKey: true, shiftKey: true }), 'chat.prev'],
    [ev('KeyP', { ctrlKey: true }), 'chat.switch'],
    [ev('KeyC', { ctrlKey: true, shiftKey: true }), 'chat.copyAnswer'],
    [ev('KeyE', { ctrlKey: true }), 'reply.toggleExplanation'],
    [ev('KeyF', { ctrlKey: true }), 'history.search'],
    [ev('KeyP', { ctrlKey: true, shiftKey: true }), 'history.pinCurrent'],
    [ev('KeyB', { ctrlKey: true }), 'app.toggleSidebar'],
    [ev('Digit1', { altKey: true }), 'panel.dock.top-left'],
    [ev('Digit2', { altKey: true }), 'panel.dock.top-right'],
    [ev('Digit3', { altKey: true }), 'panel.dock.bottom-left'],
    [ev('Digit4', { altKey: true }), 'panel.dock.bottom-right'],
    [ev('Comma', { ctrlKey: true }), 'app.settings'],
    [ev('KeyT', { ctrlKey: true }), 'theme.next'],
  ];
  for (const [e, id] of cases) {
    assert.deepEqual(lookup.get(eventAccelerator(e)), [id], id);
  }
  assert.equal(cases.length, Object.keys(DEFAULT_KEYMAP).length);
  assert.equal(eventAccelerator(ev('ControlLeft', { ctrlKey: true })), '');
  assert.equal(lookup.get(eventAccelerator(ev('KeyK'))), undefined);
});

test('the default keymap has no conflicts and avoids Super', () => {
  const km = resolveKeymap({});
  assert.deepEqual(findConflicts(km), []);
  for (const acc of Object.values(km)) assert.ok(!acc.includes('Super'), acc);
});

test('overrides replace, disable, add, and bad ones are ignored', () => {
  const km = resolveKeymap({
    'chat.new': 'ctrl+shift+n',
    'theme.next': '',
    'my.command': 'Alt+M',
    'app.settings': 'Ctrl+Nope',
    'app.toggleSidebar': 'Escape',
    'history.search': 42,
  });
  assert.equal(km['chat.new'], 'Ctrl+Shift+N');
  assert.equal(km['theme.next'], '');
  assert.equal(km['my.command'], 'Alt+M');
  assert.equal(km['app.settings'], 'Ctrl+,');
  assert.equal(km['app.toggleSidebar'], 'Ctrl+B');
  assert.equal(km['history.search'], 'Ctrl+F');
  assert.equal(buildLookup(km).has(''), false);
});

test('findConflicts reports commands that share a key', () => {
  const km = resolveKeymap({ 'theme.next': 'ctrl+k' });
  assert.deepEqual(findConflicts(km), [['app.commandBar', 'theme.next']]);
  assert.deepEqual(buildLookup(km).get('Ctrl+K'), ['app.commandBar', 'theme.next']);
});

test('reserved keys and typing-safe keys', () => {
  assert.equal(isReserved('Esc'), true);
  assert.equal(isReserved('Return'), true);
  assert.equal(isReserved('Ctrl+Enter'), false);
  assert.equal(worksWhileTyping('Ctrl+K'), true);
  assert.equal(worksWhileTyping('Alt+1'), true);
  assert.equal(worksWhileTyping('F2'), true);
  assert.equal(worksWhileTyping('Shift+K'), false);
  assert.equal(worksWhileTyping('K'), false);
});
