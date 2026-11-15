import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccelerator, keyEventToAccelerator, duplicateHotkeys, hotkeyWarning } from '../../src/renderer/lib/accelerator.js';

test('empty accelerator means disabled', () => {
  assert.deepEqual(validateAccelerator(''), { ok: true, value: '' });
  assert.deepEqual(validateAccelerator('   '), { ok: true, value: '' });
  assert.deepEqual(validateAccelerator(undefined), { ok: true, value: '' });
});

test('valid accelerators are normalized', () => {
  assert.deepEqual(validateAccelerator('super+shift+s'), { ok: true, value: 'Super+Shift+S' });
  assert.deepEqual(validateAccelerator(' Ctrl + Alt + f5 '), { ok: true, value: 'Ctrl+Alt+F5' });
  assert.deepEqual(validateAccelerator('PrintScreen'), { ok: true, value: 'PrintScreen' });
  assert.deepEqual(validateAccelerator('Ctrl++'), { ok: true, value: 'Ctrl+Plus' });
  assert.deepEqual(validateAccelerator('CmdOrCtrl+/'), { ok: true, value: 'CmdOrCtrl+/' });
});

test('invalid accelerators explain why', () => {
  for (const bad of ['Super+Shift', 'Ctrl+A+B', 'Ctrl+Banana', 'Ctrl++A', 'Shift+Shift+A', '+A']) {
    const r = validateAccelerator(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.error.length > 0);
  }
});

test('keyEventToAccelerator uses code and modifiers', () => {
  assert.equal(keyEventToAccelerator({ code: 'KeyS', key: 'S', shiftKey: true, metaKey: true }), 'Shift+Super+S');
  assert.equal(keyEventToAccelerator({ code: 'Digit2', ctrlKey: true, altKey: true }), 'Ctrl+Alt+2');
  assert.equal(keyEventToAccelerator({ code: 'F12' }), 'F12');
  assert.equal(keyEventToAccelerator({ code: 'ArrowUp', ctrlKey: true }), 'Ctrl+Up');
  assert.equal(keyEventToAccelerator({ code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(keyEventToAccelerator({ code: 'MetaLeft', metaKey: true }), null);
  // Every recorded accelerator must pass validation.
  for (const code of ['KeyA', 'Digit0', 'Numpad5', 'F1', 'Space', 'Minus', 'NumpadAdd', 'PrintScreen']) {
    const acc = keyEventToAccelerator({ code, ctrlKey: true });
    assert.equal(validateAccelerator(acc).ok, true, `${code} -> ${acc}`);
  }
});

test('duplicateHotkeys finds clashes case-insensitively and ignores empty', () => {
  assert.deepEqual(
    duplicateHotkeys({ a: 'Super+Shift+S', b: 'super+shift+s', c: '', d: '' }),
    [['a', 'b']],
  );
  assert.deepEqual(duplicateHotkeys({ a: 'Super+S', b: 'Super+A' }), []);
});

test('hotkeyWarning flags Super combos and known Cinnamon shortcuts, not the defaults', () => {
  assert.match(hotkeyWarning('Super+Shift+S'), /Super/);
  assert.match(hotkeyWarning('meta+a'), /Super/);
  assert.match(hotkeyWarning('ctrl+alt+t'), /Cinnamon already uses/);
  assert.match(hotkeyWarning('PrintScreen'), /Cinnamon already uses/);
  for (const ok of ['Ctrl+Alt+S', 'Ctrl+Alt+A', 'Ctrl+Alt+P', 'Pause', '', 'Ctrl+Banana']) {
    assert.equal(hotkeyWarning(ok), '', ok);
  }
});
