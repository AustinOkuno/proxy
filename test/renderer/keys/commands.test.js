import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCommand, runCommand, listCommands, isAvailable, setKeymap } from '../../../src/renderer/keys/commands.js';

test('register, list with keys, run, unregister', async () => {
  let ran = 0;
  const off = registerCommand({ id: 't.one', title: 'One', group: 'Test', run: () => { ran += 1; } });
  setKeymap({ 't.one': 'Ctrl+1' });
  assert.deepEqual(listCommands().find((c) => c.id === 't.one'), { id: 't.one', title: 'One', group: 'Test', keys: 'Ctrl+1' });
  await runCommand('t.one');
  assert.equal(ran, 1);
  off();
  assert.equal(isAvailable('t.one'), false);
  await runCommand('t.one');
  assert.equal(ran, 1);
});

test('when() gates a command; a throwing when() counts as unavailable', async () => {
  let ok = false;
  let ran = 0;
  const off1 = registerCommand({ id: 't.gated', title: 'Gated', run: () => { ran += 1; }, when: () => ok });
  const off2 = registerCommand({ id: 't.broken', title: 'Broken', run: () => {}, when: () => { throw new Error('x'); } });
  await runCommand('t.gated');
  assert.equal(ran, 0);
  ok = true;
  await runCommand('t.gated');
  assert.equal(ran, 1);
  assert.equal(isAvailable('t.broken'), false);
  off1();
  off2();
});

test('registering an id again replaces it; the old unregister does not remove the new one', () => {
  const off1 = registerCommand({ id: 't.dup', title: 'Old', run: () => {} });
  const off2 = registerCommand({ id: 't.dup', title: 'New', run: () => {} });
  off1();
  assert.equal(listCommands().find((c) => c.id === 't.dup').title, 'New');
  off2();
  assert.throws(() => registerCommand({ id: '', run: () => {} }));
});
