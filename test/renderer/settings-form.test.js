import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSettingsPatch } from '../../src/renderer/lib/settings-form.js';

const require = createRequire(import.meta.url);
const { SEND_MODES, PANEL_VISIBILITY, ANSWER_STYLES, defaultSettings } = require('../../src/shared/contracts.js');
const enums = { SEND_MODES, PANEL_VISIBILITY, ANSWER_STYLES };

test('defaults produce a valid patch', () => {
  const d = defaultSettings();
  const r = buildSettingsPatch(d, enums);
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    hotkeys: d.hotkeys,
    sendMode: d.sendMode,
    panelVisibility: d.panelVisibility,
    answerStyle: d.answerStyle,
  });
});

test('hotkeys are normalized and empty disables', () => {
  const r = buildSettingsPatch({
    hotkeys: { regionSnip: 'ctrl+alt+s', fullScreenshot: '', togglePanel: 'Super+P' },
    sendMode: 'wait', panelVisibility: 'toggle', answerStyle: 'answer',
  }, enums);
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch.hotkeys, { regionSnip: 'Ctrl+Alt+S', fullScreenshot: '', togglePanel: 'Super+P' });
});

test('errors for bad hotkeys, duplicates and missing choices', () => {
  const r = buildSettingsPatch({
    hotkeys: { regionSnip: 'Super+S', fullScreenshot: 'super+s', togglePanel: 'Super+' },
    sendMode: 'later', panelVisibility: null, answerStyle: 'both',
  }, enums);
  assert.equal(r.ok, false);
  assert.deepEqual(r.patch, {});
  assert.deepEqual(Object.keys(r.errors).sort(), [
    'hotkeys.fullScreenshot', 'hotkeys.regionSnip', 'hotkeys.togglePanel', 'panelVisibility', 'sendMode',
  ]);
});
