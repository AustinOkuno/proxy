import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSessions, isUsefulMove } from '../../src/renderer/lib/folders.js';

const sessions = [
  { id: 'a', folderId: 'f2' },
  { id: 'b', folderId: null },
  { id: 'c', folderId: 'f1' },
  { id: 'd', folderId: 'gone' },
  { id: 'e', folderId: 'f2' },
];
const folders = [{ id: 'f1', name: 'One' }, { id: 'f2', name: 'Two' }, { id: 'f3', name: 'Empty' }];

test('groupSessions keeps folder order and chat order; unknown folders fall back to top level', () => {
  const { groups, loose } = groupSessions(sessions, folders);
  assert.deepEqual(groups.map((g) => [g.folder.id, g.sessions.map((s) => s.id)]), [
    ['f1', ['c']], ['f2', ['a', 'e']], ['f3', []],
  ]);
  assert.deepEqual(loose.map((s) => s.id), ['b', 'd']);
});

test('groupSessions with no folders puts everything at the top level', () => {
  const { groups, loose } = groupSessions(sessions, []);
  assert.equal(groups.length, 0);
  assert.equal(loose.length, sessions.length);
});

test('isUsefulMove', () => {
  assert.equal(isUsefulMove(sessions, 'a', 'f2'), false);
  assert.equal(isUsefulMove(sessions, 'a', 'f1'), true);
  assert.equal(isUsefulMove(sessions, 'a', null), true);
  assert.equal(isUsefulMove(sessions, 'b', null), false);
  assert.equal(isUsefulMove(sessions, 'b', undefined), false);
  assert.equal(isUsefulMove(sessions, 'zzz', 'f1'), false);
});
