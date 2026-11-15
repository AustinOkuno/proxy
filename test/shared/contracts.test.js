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
  assert.equal(s.hotkeys.regionSnip, 'Ctrl+Alt+S');
  assert.equal(s.hotkeys.fullScreenshot, 'Ctrl+Alt+A');
  assert.equal(s.hotkeys.togglePanel, 'Ctrl+Alt+P');
  assert.equal(s.sendMode, c.SEND_MODES.INSTANT);
  assert.equal(s.panelVisibility, c.PANEL_VISIBILITY.ALWAYS);
});

test('defaultSettings() returns a mutable copy', () => {
  const s = c.defaultSettings();
  s.hotkeys.regionSnip = 'X';
  assert.equal(c.DEFAULT_SETTINGS.hotkeys.regionSnip, 'Ctrl+Alt+S');
});

test('Claude (Pro) provider and models', () => {
  assert.equal(c.PROVIDERS.CLAUDE_PRO, 'claude-pro');
  assert.ok(Object.values(c.CLAUDE_MODELS).includes(c.defaultSettings().claudeModel));
  assert.equal(c.defaultSettings().claudeModel, 'haiku');
});

test('default hotkeys avoid Super (Cinnamon grabs it) and differ from the v1 defaults', () => {
  const s = c.defaultSettings();
  assert.ok(c.SETTINGS_VERSION >= 2);
  for (const [name, acc] of Object.entries(s.hotkeys)) {
    assert.doesNotMatch(acc, /super|meta/i, name);
    assert.notEqual(acc, c.LEGACY_HOTKEY_DEFAULTS[name]);
  }
  for (const name of Object.keys(c.LEGACY_HOTKEY_DEFAULTS)) assert.ok(name in s.hotkeys, name);
});

// ---- UI phase (SPEC 9.5) ---------------------------------------------------

test('UI phase: new IPC channels exist with the agreed names', () => {
  assert.equal(c.INVOKE.HISTORY_SET_PINNED, 'history:set-pinned');
  assert.equal(c.INVOKE.HISTORY_SEARCH, 'history:search');
  assert.equal(c.INVOKE.USAGE_GET, 'usage:get');
  assert.equal(c.INVOKE.WINDOW_DOCK, 'window:dock');
  for (const op of ['import', 'get', 'list', 'delete']) {
    assert.ok(Object.values(c.INVOKE).includes(`assets:${op}`), op);
  }
  assert.equal(c.EVENTS.USAGE_CHANGED, 'usage:changed');
  for (const ch of Object.values(c.INVOKE)) assert.doesNotMatch(ch, /^overlay:/);
});

test('UI phase: panel defaults to the top right corner', () => {
  const s = c.defaultSettings();
  assert.ok(Object.values(c.PANEL_DOCKS).includes(s.panel.dock));
  assert.equal(s.panel.dock, 'top-right');
  assert.equal(s.panel.snap, true);
  const { min, max } = c.SETTINGS_LIMITS.panelMargin;
  assert.ok(s.panel.margin >= min && s.panel.margin <= max);
});

test('UI phase: appearance defaults cover every font level within limits', () => {
  const { appearance } = c.defaultSettings();
  assert.equal(appearance.themeId, 'dungeon');
  assert.deepEqual(Object.keys(appearance.fonts).sort(), [...c.FONT_LEVELS].sort());
  const L = c.SETTINGS_LIMITS;
  for (const [level, font] of Object.entries(appearance.fonts)) {
    assert.ok(font.family && font.family.length <= L.fontFamilyMaxLength, level);
    assert.ok(font.size >= L.fontSize.min && font.size <= L.fontSize.max, level);
    if (font.weight !== undefined) assert.ok(font.weight >= L.fontWeight.min && font.weight <= L.fontWeight.max, level);
  }
  assert.deepEqual(appearance.customThemes, []);
  assert.equal(appearance.effects, null);
  assert.ok(L.backgroundFits.includes(appearance.background.fit));
  assert.equal(appearance.background.assetId, null);
});

test('UI phase: keymap and usage defaults', () => {
  const s = c.defaultSettings();
  assert.deepEqual(s.keymap, {});
  assert.deepEqual(s.usage, { show: true, geminiDailyRequests: null });
});
