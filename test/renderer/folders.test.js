import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSessions, isUsefulMove, pinnedFirst, sidebarOrder, stepChat, splitSnippet } from '../../src/renderer/lib/folders.js';

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

// --- pins (SPEC 9.5.5) ------------------------------------------------------

test('pinnedFirst: pinned items first, latest pin first; the rest keep their order', () => {
  const items = [
    { id: 'a' }, { id: 'b', pinned: true, pinnedAt: 10 }, { id: 'c' }, { id: 'd', pinned: true, pinnedAt: 20 },
    { id: 'e', pinned: false, pinnedAt: null },
  ];
  assert.deepEqual(pinnedFirst(items).map((x) => x.id), ['d', 'b', 'a', 'c', 'e']);
  assert.deepEqual(pinnedFirst([]), []);
});

test('groupSessions: pinned folders, other folders, pinned chats, other chats; pinned first inside folders', () => {
  const ss = [
    { id: 'n1', folderId: null },
    { id: 'p1', folderId: null, pinned: true, pinnedAt: 5 },
    { id: 'in1', folderId: 'f1' },
    { id: 'in2', folderId: 'f1', pinned: true, pinnedAt: 1 },
    { id: 'n2', folderId: null },
  ];
  const fs = [{ id: 'f1' }, { id: 'f2', pinned: true, pinnedAt: 3 }, { id: 'f3' }];
  const { groups, loose } = groupSessions(ss, fs);
  assert.deepEqual(groups.map((g) => g.folder.id), ['f2', 'f1', 'f3']);
  assert.deepEqual(groups[1].sessions.map((s) => s.id), ['in2', 'in1']);
  assert.deepEqual(loose.map((s) => s.id), ['p1', 'n1', 'n2']);
  assert.deepEqual(sidebarOrder(ss, fs), ['in2', 'in1', 'p1', 'n1', 'n2']);
});

test('stepChat wraps around and handles no current chat', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(stepChat(order, 'a', 1), 'b');
  assert.equal(stepChat(order, 'c', 1), 'a');
  assert.equal(stepChat(order, 'a', -1), 'c');
  assert.equal(stepChat(order, null, 1), 'a');
  assert.equal(stepChat(order, 'zzz', -1), 'c');
  assert.equal(stepChat([], 'a', 1), null);
});

test('splitSnippet cuts around the match and clamps bad indexes', () => {
  assert.deepEqual(splitSnippet({ snippet: '…the Water cycle', matchStart: 5, matchLength: 5 }), { before: '…the ', match: 'Water', after: ' cycle' });
  assert.deepEqual(splitSnippet({ snippet: 'abc', matchStart: 10, matchLength: 2 }), { before: 'abc', match: '', after: '' });
  assert.deepEqual(splitSnippet(null), { before: '', match: '', after: '' });
});
