import test from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from '../../../src/renderer/theme/look-settings.js';

test('errorText strips the IPC wrapper so the user sees the reason', () => {
  const err = new Error("Error invoking remote method 'assets:import': Error: That file is 20.0 MB. The limit is 15.0 MB.");
  assert.equal(errorText(err), 'That file is 20.0 MB. The limit is 15.0 MB.');
  assert.equal(errorText(new Error('plain')), 'plain');
  assert.equal(errorText('text'), 'text');
});
