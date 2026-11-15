'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSettingsStore, sanitizePatch } = require('../../src/main/core/settings');
const { defaultSettings, SETTINGS_VERSION, SETTINGS_LIMITS } = require('../../src/shared/contracts');
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
  assert.equal(out.hotkeys.fullScreenshot, 'Ctrl+Alt+A');
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
  assert.equal(s.get().hotkeys.regionSnip, 'Ctrl+Alt+S');
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

test('v1 settings on the old Super+Shift defaults move to the new defaults; custom hotkeys stay', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({
      version: 1,
      hotkeys: { regionSnip: 'Super+Shift+S', fullScreenshot: 'Alt+F9', togglePanel: 'super+shift+p' },
      sendMode: 'wait',
    }),
  );
  const s = createSettingsStore({ dataDir: dir, logger: quietLogger() });
  const got = s.get();
  assert.deepEqual(got.hotkeys, { regionSnip: 'Ctrl+Alt+S', fullScreenshot: 'Alt+F9', togglePanel: 'Ctrl+Alt+P' });
  assert.equal(got.sendMode, 'wait');
  assert.equal(got.version, SETTINGS_VERSION);
  // Saved right away, so the next start doesn't migrate again.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(onDisk.version, SETTINGS_VERSION);
  assert.equal(onDisk.hotkeys.regionSnip, 'Ctrl+Alt+S');
});

test('v2 settings keep a Super hotkey the user picked on purpose', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ version: 2, hotkeys: { regionSnip: 'Super+Shift+S' } }),
  );
  const s = createSettingsStore({ dataDir: dir, logger: quietLogger() });
  assert.equal(s.get().hotkeys.regionSnip, 'Super+Shift+S');
});

// ---------------------------------------------------------------------------
// UI phase keys (SPEC 9.5.3)
// ---------------------------------------------------------------------------

const store = () => createSettingsStore({ dataDir: tmpDir(), logger: quietLogger() });

const goodTheme = (over = {}) => ({
  id: 'user-abc123',
  name: 'My Theme',
  base: 'dark',
  colors: { bg: '#070b1a', 'answer-glow': 'rgba(62, 230, 255, 0.6)', accent: 'hsl(190 100% 62%)' },
  effects: { scanlines: 0.3, glow: 1, vignette: 0 },
  radius: 4,
  ...over,
});

test('v3 defaults are there on a fresh store', () => {
  const got = store().get();
  assert.equal(got.version, SETTINGS_VERSION);
  assert.equal(got.appearance.themeId, 'dungeon');
  assert.equal(got.panel.dock, 'top-right');
  assert.deepEqual(got.keymap, {});
  assert.deepEqual(got.usage, { show: true, geminiDailyRequests: null });
});

test('appearance.themeId accepts an id and rejects junk', () => {
  const s = store();
  assert.equal(s.update({ appearance: { themeId: 'neon-night' } }).appearance.themeId, 'neon-night');
  assert.equal(s.update({ appearance: { themeId: 'bad id;' } }).appearance.themeId, 'neon-night');
  assert.equal(s.update({ appearance: { themeId: 7 } }).appearance.themeId, 'neon-night');
});

test('appearance.fonts merges per level and per field; bad sizes, weights, families and levels dropped', () => {
  const s = store();
  const log = quietLogger();
  const s2 = createSettingsStore({ dataDir: tmpDir(), logger: log });
  let f = s.update({ appearance: { fonts: { answer: { size: 20 } } } }).appearance.fonts;
  assert.deepEqual(f.answer, { family: 'JetBrains Mono', size: 20, weight: 700 });
  assert.deepEqual(f.title, defaultSettings().appearance.fonts.title);
  f = s.update({ appearance: { fonts: { body: { family: '  Fira Sans ' }, code: { size: 9 }, ui: { size: 41 } } } }).appearance.fonts;
  assert.equal(f.body.family, 'Fira Sans');
  assert.equal(f.code.size, 13);
  assert.equal(f.ui.size, 12);
  f = s.update({ appearance: { fonts: { title: { weight: 1000, family: 'x; color: red' }, nope: { size: 12 } } } }).appearance.fonts;
  assert.deepEqual(f.title, defaultSettings().appearance.fonts.title);
  assert.equal(f.nope, undefined);
  f = s.update({ appearance: { fonts: { title: { weight: 650.4 } } } }).appearance.fonts;
  assert.equal(f.title.weight, 650);
  s2.update({ appearance: { fonts: { body: { family: 'A"B', size: SETTINGS_LIMITS.fontSize.max } } } });
  assert.ok(log.warnings.some((w) => /appearance\.fonts\.body\.family/.test(w)));
});

test('appearance.customThemes keeps valid themes and drops bad ones one by one', () => {
  const s = store();
  const themes = s.update({
    appearance: {
      customThemes: [
        goodTheme(),
        goodTheme(), // duplicate id
        goodTheme({ id: 'dungeon' }), // not a user id
        goodTheme({ id: 'user-2', name: '' }),
        goodTheme({ id: 'user-3', base: 'grey' }),
        goodTheme({ id: 'user-4', radius: 13 }),
        goodTheme({ id: 'user-5', effects: { scanlines: 2, glow: 0, vignette: 0 } }),
        goodTheme({ id: 'user-6', colors: { bg: 'red;}body{display:none', text: 'url(x)', 'Bad Key': '#fff', ok: '#fff' } }),
        'not a theme',
      ],
    },
  }).appearance.customThemes;
  assert.deepEqual(themes.map((t) => t.id), ['user-abc123', 'user-6']);
  assert.deepEqual(themes[0], goodTheme());
  assert.deepEqual(themes[1].colors, { ok: '#fff' });
});

test('appearance.customThemes is capped and replaced whole', () => {
  const s = store();
  const many = Array.from({ length: SETTINGS_LIMITS.customThemesMax + 5 }, (_, i) => goodTheme({ id: `user-${i}` }));
  assert.equal(s.update({ appearance: { customThemes: many } }).appearance.customThemes.length, SETTINGS_LIMITS.customThemesMax);
  assert.equal(s.update({ appearance: { customThemes: [goodTheme()] } }).appearance.customThemes.length, 1);
  assert.equal(s.update({ appearance: { customThemes: 'x' } }).appearance.customThemes.length, 1);
});

test('appearance.customFonts, effects and background', () => {
  const s = store();
  let a = s.update({
    appearance: {
      customFonts: [{ assetId: 'a1', family: 'My Font' }, { assetId: '../x', family: 'Bad' }, { family: 'NoId' }],
      effects: { scanlines: 0.5, glow: 0, vignette: 1 },
      background: { assetId: 'img1', dim: 0.2 },
    },
  }).appearance;
  assert.deepEqual(a.customFonts, [{ assetId: 'a1', family: 'My Font' }]);
  assert.deepEqual(a.effects, { scanlines: 0.5, glow: 0, vignette: 1 });
  assert.deepEqual(a.background, { assetId: 'img1', fit: 'cover', dim: 0.2, blur: 0 });
  a = s.update({ appearance: { effects: { scanlines: 0.5 }, background: { fit: 'stretch', blur: 21, assetId: null } } }).appearance;
  assert.deepEqual(a.effects, { scanlines: 0.5, glow: 0, vignette: 1 }, 'partial effects is dropped');
  assert.deepEqual(a.background, { assetId: null, fit: 'cover', dim: 0.2, blur: 0 });
  a = s.update({ appearance: { effects: null, background: { fit: 'contain', blur: 20 } } }).appearance;
  assert.equal(a.effects, null);
  assert.deepEqual(a.background, { assetId: null, fit: 'contain', dim: 0.2, blur: 20 });
});

test('panel validates dock, snap, margin and explanationCollapsed', () => {
  const s = store();
  let p = s.update({ panel: { dock: 'bottom-left', snap: false, margin: 30.6, explanationCollapsed: true } }).panel;
  assert.deepEqual(p, { dock: 'bottom-left', snap: false, margin: 31, explanationCollapsed: true });
  p = s.update({ panel: { dock: 'middle', snap: 'yes', margin: 65, explanationCollapsed: 1, extra: 1 } }).panel;
  assert.deepEqual(p, { dock: 'bottom-left', snap: false, margin: 31, explanationCollapsed: true });
  assert.equal(s.update({ panel: { dock: 'free' } }).panel.dock, 'free');
  assert.equal(s.update({ panel: 'x' }).panel.dock, 'free');
});

test('keymap merges per key, allows "" to disable and null to restore the default', () => {
  const s = store();
  let k = s.update({ keymap: { 'chat.new': 'Ctrl+Shift+N', 'theme.next': '' } }).keymap;
  assert.deepEqual(k, { 'chat.new': 'Ctrl+Shift+N', 'theme.next': '' });
  k = s.update({ keymap: { 'chat.new': null, 'history.search': ' Ctrl+F ', 'bad id': 'X', 'x.y': 5, 'z': 'A'.repeat(101) } }).keymap;
  assert.deepEqual(k, { 'theme.next': '', 'history.search': 'Ctrl+F' });
});

test('usage validates show and the Gemini daily budget', () => {
  const s = store();
  assert.deepEqual(s.update({ usage: { show: false, geminiDailyRequests: 250 } }).usage, { show: false, geminiDailyRequests: 250 });
  assert.deepEqual(s.update({ usage: { geminiDailyRequests: 0 } }).usage.geminiDailyRequests, 250);
  assert.deepEqual(s.update({ usage: { geminiDailyRequests: 1.5 } }).usage.geminiDailyRequests, 250);
  assert.deepEqual(s.update({ usage: { geminiDailyRequests: SETTINGS_LIMITS.geminiDailyRequests.max + 1 } }).usage.geminiDailyRequests, 250);
  assert.equal(s.update({ usage: { geminiDailyRequests: null } }).usage.geminiDailyRequests, null);
  assert.equal(s.update({ usage: { show: 'no' } }).usage.show, false);
});

test('hotkeys.focusPanel is accepted before it has a default', () => {
  const s = store();
  assert.equal(s.update({ hotkeys: { focusPanel: 'Ctrl+Alt+Space' } }).hotkeys.focusPanel, 'Ctrl+Alt+Space');
});

test('v3 keys survive a restart', () => {
  const dir = tmpDir();
  const s = createSettingsStore({ dataDir: dir, logger: quietLogger() });
  const out = s.update({
    appearance: { themeId: 'studio', customThemes: [goodTheme()], fonts: { code: { family: 'Hack' } } },
    panel: { dock: 'top-left' },
    keymap: { 'chat.new': 'Alt+N' },
    usage: { geminiDailyRequests: 100 },
  });
  assert.deepEqual(createSettingsStore({ dataDir: dir, logger: quietLogger() }).get(), out);
});

test('a v2 settings file loads with the v3 defaults filled in and nothing the user set changed', () => {
  const dir = tmpDir();
  const v2 = {
    version: 2,
    hotkeys: { regionSnip: 'Alt+F9', fullScreenshot: 'Ctrl+Alt+A', togglePanel: 'Ctrl+Alt+P' },
    sendMode: 'wait',
    panelVisibility: 'toggle',
    answerStyle: 'answer',
    provider: 'claude-pro',
    claudeModel: 'sonnet',
    panelBounds: { x: 10, y: 20, width: 400, height: 600 },
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(v2));
  const got = createSettingsStore({ dataDir: dir, logger: quietLogger() }).get();
  const expected = { ...defaultSettings(), ...v2, hotkeys: { ...defaultSettings().hotkeys, ...v2.hotkeys }, version: SETTINGS_VERSION };
  assert.deepEqual(got, expected);
});

test('bad v3 entries in settings.json are dropped on load, good ones kept', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({
      version: 3,
      appearance: { themeId: 'neon-night', fonts: { answer: { size: 999 } }, customThemes: [goodTheme(), { id: 'x' }] },
      panel: { dock: 'nowhere', margin: 8 },
      usage: { geminiDailyRequests: -1 },
    }),
  );
  const log = quietLogger();
  const got = createSettingsStore({ dataDir: dir, logger: log }).get();
  assert.equal(got.appearance.themeId, 'neon-night');
  assert.equal(got.appearance.fonts.answer.size, 17);
  assert.equal(got.appearance.customThemes.length, 1);
  assert.equal(got.panel.dock, 'top-right');
  assert.equal(got.panel.margin, 8);
  assert.equal(got.usage.geminiDailyRequests, null);
  assert.ok(log.warnings.some((w) => /ignored invalid entries/.test(w)));
});
