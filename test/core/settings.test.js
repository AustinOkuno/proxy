'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSettingsStore, sanitizePatch } = require('../../src/main/core/settings');
const { defaultSettings } = require('../../src/shared/contracts');
const { tmpDir, quietLogger } = require('./helpers');

test('starts with defaults when there is no file', () => {
  const s = createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });
  assert.deepEqual(s.get(), defaultSettings());
});

test('update validates enums, drops unknown keys, deep-merges hotkeys and persists', () => {
  const dir = tmpDir();
  const log = quietLogger();
  const s = createSettingsStore({ dataDir: dir, logger: log });
  const out = s.update({
    sendMode: 'wait',
    answerStyle: 'nope',
    bogus: 1,
    hotkeys: { regionSnip: 'Ctrl+Alt+S', unknownKey: 'X' },
  });
  assert.equal(out.sendMode, 'wait');
  assert.equal(out.answerStyle, 'both');
  assert.equal(out.bogus, undefined);
  assert.equal(out.hotkeys.regionSnip, 'Ctrl+Alt+S');
  assert.equal(out.hotkeys.fullScreenshot, 'Super+Shift+A');
  assert.ok(log.warnings.length > 0);

  const again = createSettingsStore({ dataDir: dir, logger: quietLogger() });
  assert.deepEqual(again.get(), out);
});

test('empty hotkey string is allowed (disables it)', () => {
  const s = createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });
  assert.equal(s.update({ hotkeys: { togglePanel: '' } }).hotkeys.togglePanel, '');
});

test('panelBounds accepts a rect or null and rejects junk', () => {
  const s = createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });
  assert.deepEqual(s.update({ panelBounds: { x: 1, y: 2, width: 300, height: 400 } }).panelBounds,
    { x: 1, y: 2, width: 300, height: 400 });
  assert.deepEqual(s.update({ panelBounds: { x: 'a' } }).panelBounds, { x: 1, y: 2, width: 300, height: 400 });
  assert.equal(s.update({ panelBounds: null }).panelBounds, null);
});

test('onChange fires after a real change, not for no-ops; unsubscribe works', () => {
  const s = createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });
  const seen = [];
  const off = s.onChange((v) => seen.push(v.sendMode));
  s.update({ sendMode: 'wait' });
  s.update({ sendMode: 'wait' });
  off();
  s.update({ sendMode: 'instant' });
  assert.deepEqual(seen, ['wait']);
});

test('get() returns a copy', () => {
  const s = createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });
  s.get().hotkeys.regionSnip = 'X';
  assert.equal(s.get().hotkeys.regionSnip, 'Super+Shift+S');
});

test('corrupt settings.json falls back to defaults without throwing', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  const log = quietLogger();
  const s = createSettingsStore({ dataDir: dir, logger: log });
  assert.deepEqual(s.get(), defaultSettings());
  assert.ok(log.warnings.some((w) => /unreadable/.test(w)));
});

test('sanitizePatch ignores non-objects', () => {
  assert.deepEqual(sanitizePatch(null).clean, {});
  assert.deepEqual(sanitizePatch('x').clean, {});
  assert.deepEqual(sanitizePatch({ version: 99 }).clean, {});
});

test('provider and claudeModel accept the Claude (Pro) values and reject others', () => {
  const s = createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });
  let out = s.update({ provider: 'claude-pro', claudeModel: 'opus' });
  assert.equal(out.provider, 'claude-pro');
  assert.equal(out.claudeModel, 'opus');
  out = s.update({ provider: 'openai', claudeModel: 'gpt-9' });
  assert.equal(out.provider, 'claude-pro');
  assert.equal(out.claudeModel, 'opus');
});
