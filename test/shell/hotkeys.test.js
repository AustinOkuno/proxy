'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHotkeyManager, validateAccelerator, withFallbacks } = require('../../src/main/shell/hotkeys');

function fakeShortcut({ taken = [] } = {}) {
  const map = new Map();
  return {
    map,
    register(acc, cb) {
      if (taken.includes(acc) || map.has(acc)) return false;
      map.set(acc, cb);
      return true;
    },
    unregister(acc) {
      map.delete(acc);
    },
  };
}

const quietLog = { warn() {} };

function setup(opts) {
  const gs = fakeShortcut(opts);
  const calls = [];
  const errors = [];
  const mgr = createHotkeyManager({
    globalShortcut: gs,
    handlers: {
      regionSnip: () => calls.push('region'),
      fullScreenshot: () => calls.push('full'),
      togglePanel: () => calls.push('toggle'),
      focusPanel: () => calls.push('focus'),
    },
    onError: (m) => errors.push(m),
    log: quietLog,
  });
  return { gs, calls, errors, mgr };
}

const DEFAULTS = { regionSnip: 'Super+Shift+S', fullScreenshot: 'Super+Shift+A', togglePanel: 'Super+Shift+P' };

test('validateAccelerator', () => {
  assert.equal(validateAccelerator('').ok, true);
  assert.equal(validateAccelerator('Super+Shift+S').ok, true);
  assert.equal(validateAccelerator('CommandOrControl+Alt+F12').ok, true);
  assert.equal(validateAccelerator('Ctrl++').ok, true);
  assert.equal(validateAccelerator('PrintScreen').ok, true);
  assert.equal(validateAccelerator('Super+Shift').ok, false);
  assert.equal(validateAccelerator('Hyper+S').ok, false);
  assert.equal(validateAccelerator('Ctrl+Banana').ok, false);
  assert.equal(validateAccelerator('Ctrl++S').ok, false);
});

test('registers all hotkeys and calls the right handlers', () => {
  const { gs, calls, errors, mgr } = setup();
  const r = mgr.apply({ ...DEFAULTS, focusPanel: 'Ctrl+Alt+Space' });
  assert.deepEqual(r, { regionSnip: 'ok', fullScreenshot: 'ok', togglePanel: 'ok', focusPanel: 'ok' });
  gs.map.get('Super+Shift+S')();
  gs.map.get('Super+Shift+A')();
  gs.map.get('Super+Shift+P')();
  gs.map.get('Ctrl+Alt+Space')();
  assert.deepEqual(calls, ['region', 'full', 'toggle', 'focus']);
  assert.deepEqual(errors, []);
});

test('a taken hotkey reports a readable error naming the key and keeps the others', () => {
  const { gs, errors, mgr } = setup({ taken: ['Super+Shift+S'] });
  const r = mgr.apply(DEFAULTS);
  assert.equal(r.regionSnip, 'failed');
  assert.equal(r.fullScreenshot, 'ok');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Super\+Shift\+S/);
  assert.ok(gs.map.has('Super+Shift+A'));
});

test('empty disables, invalid and duplicates are reported', () => {
  const { gs, errors, mgr } = setup();
  const r = mgr.apply({ regionSnip: '', fullScreenshot: 'Ctrl+Nope', togglePanel: 'Alt+X' });
  assert.deepEqual(r, { regionSnip: 'disabled', fullScreenshot: 'invalid', togglePanel: 'ok', focusPanel: 'disabled' });
  assert.equal(errors.length, 1);

  const r2 = mgr.apply({ regionSnip: 'Alt+Y', fullScreenshot: 'alt+y', togglePanel: 'Alt+X' });
  assert.equal(r2.fullScreenshot, 'duplicate');
  assert.deepEqual([...gs.map.keys()].sort(), ['Alt+X', 'Alt+Y']);
});

test('re-applying the same config does nothing; a change re-registers', () => {
  const { gs, mgr } = setup();
  mgr.apply(DEFAULTS);
  assert.equal(mgr.apply({ ...DEFAULTS }), null);
  mgr.apply({ ...DEFAULTS, regionSnip: 'Ctrl+Alt+S' });
  assert.ok(gs.map.has('Ctrl+Alt+S'));
  assert.ok(!gs.map.has('Super+Shift+S'));
  mgr.dispose();
  assert.equal(gs.map.size, 0);
});

test('withFallbacks fills a missing focusPanel but keeps an empty one (disabled)', () => {
  assert.equal(withFallbacks(DEFAULTS).focusPanel, 'Ctrl+Alt+Space');
  assert.equal(withFallbacks({ ...DEFAULTS, focusPanel: '' }).focusPanel, '');
  assert.equal(withFallbacks({ ...DEFAULTS, focusPanel: 'Ctrl+Alt+F' }).focusPanel, 'Ctrl+Alt+F');
  assert.equal(withFallbacks(undefined).focusPanel, 'Ctrl+Alt+Space');
  assert.equal(withFallbacks(DEFAULTS).regionSnip, 'Super+Shift+S');
});

test('a focusPanel key equal to a capture key is reported as a duplicate', () => {
  const { errors, mgr } = setup();
  const r = mgr.apply({ ...DEFAULTS, focusPanel: 'super+shift+s' });
  assert.equal(r.focusPanel, 'duplicate');
  assert.match(errors[0], /Focus panel/);
});
