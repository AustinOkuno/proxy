'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../../src/shared/contracts');

test('IPC channel names are unique across INVOKE and EVENTS', () => {
  const all = [...Object.values(c.INVOKE), ...Object.values(c.EVENTS)];
  assert.equal(new Set(all).size, all.length);
});

test('default settings use valid enum values', () => {
  const s = c.defaultSettings();
  assert.ok(Object.values(c.SEND_MODES).includes(s.sendMode));
  assert.ok(Object.values(c.PANEL_VISIBILITY).includes(s.panelVisibility));
  assert.ok(Object.values(c.ANSWER_STYLES).includes(s.answerStyle));
  assert.ok(Object.values(c.PROVIDERS).includes(s.provider));
  assert.equal(s.version, c.SETTINGS_VERSION);
});

test('agreed default hotkeys and modes', () => {
  const s = c.defaultSettings();
  assert.equal(s.hotkeys.regionSnip, 'Super+Shift+S');
  assert.equal(s.hotkeys.fullScreenshot, 'Super+Shift+A');
  assert.equal(s.sendMode, c.SEND_MODES.INSTANT);
  assert.equal(s.panelVisibility, c.PANEL_VISIBILITY.ALWAYS);
});

test('defaultSettings() returns a mutable copy', () => {
  const s = c.defaultSettings();
  s.hotkeys.regionSnip = 'X';
  assert.equal(c.DEFAULT_SETTINGS.hotkeys.regionSnip, 'Super+Shift+S');
});
