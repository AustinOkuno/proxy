'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHistoryStore, autoTitle } = require('../../src/main/core/history');
const { tmpDir, quietLogger } = require('./helpers');

const store = (dir = tmpDir()) => createHistoryStore({ dataDir: dir, logger: quietLogger() });
const img = { mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };

test('create, append, get, list newest first', () => {
  const h = store();
  const a = h.createSession();
  const b = h.createSession();
  assert.equal(a.title, 'New chat');
  assert.deepEqual(a.messages, []);
  h.appendMessage(a.id, { role: 'user', text: 'hello' });
  const list = h.listSessions();
  assert.deepEqual(list.map((s) => s.id), [a.id, b.id]);
  assert.equal(list[0].messageCount, 1);
  const got = h.getSession(a.id);
  assert.equal(got.messages[0].text, 'hello');
  assert.ok(got.messages[0].id);
  assert.ok(got.messages[0].createdAt);
  assert.equal(got.titleLocked, undefined, 'internal fields are not exposed');
});

test('persists across restarts, with images inline', () => {
  const dir = tmpDir();
  const h = store(dir);
  const s = h.createSession();
  h.appendMessage(s.id, { role: 'user', text: '', images: [img] });
  h.appendMessage(s.id, { role: 'assistant', answer: 'A', explanation: 'E' });
  const h2 = store(dir);
  const got = h2.getSession(s.id);
  assert.equal(got.messages.length, 2);
  assert.deepEqual(got.messages[0].images, [img]);
  assert.equal(got.title, 'Screenshot');
});

test('auto title from first user message, rename overrides, empty rename reverts', () => {
  const h = store();
  const s = h.createSession();
  h.appendMessage(s.id, { role: 'user', text: 'What is the capital of France and why is it Paris anyway' });
  let title = h.getSession(s.id).title;
  assert.ok(title.length <= 41, title);
  assert.ok(title.startsWith('What is the capital'));
  h.appendMessage(s.id, { role: 'user', text: 'second' });
  assert.equal(h.getSession(s.id).title, title);

  assert.equal(h.renameSession(s.id, '  My chat ').title, 'My chat');
  h.appendMessage(s.id, { role: 'user', text: 'third' });
  assert.equal(h.getSession(s.id).title, 'My chat');

  title = h.renameSession(s.id, '').title;
  assert.ok(title.startsWith('What is the capital'));
});

test('rename before first message keeps the custom title', () => {
  const h = store();
  const s = h.createSession();
  h.renameSession(s.id, 'Custom');
  h.appendMessage(s.id, { role: 'user', text: 'hi' });
  assert.equal(h.getSession(s.id).title, 'Custom');
});

test('delete removes the session and its file', () => {
  const dir = tmpDir();
  const h = store(dir);
  const s = h.createSession();
  h.deleteSession(s.id);
  assert.equal(h.getSession(s.id), null);
  assert.equal(h.listSessions().length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'history', `${s.id}.json`)), false);
  assert.equal(store(dir).listSessions().length, 0);
  h.deleteSession('does-not-exist'); // no throw
});

test('unsafe ids are rejected', () => {
  const h = store();
  assert.equal(h.getSession('../settings'), null);
  assert.throws(() => h.appendMessage('../x', { role: 'user', text: 'x' }));
  assert.throws(() => h.renameSession('nope', 'x'));
});

test('corrupt index is rebuilt from session files; corrupt session is skipped', () => {
  const dir = tmpDir();
  const h = store(dir);
  const a = h.createSession();
  const b = h.createSession();
  h.appendMessage(a.id, { role: 'user', text: 'keep me' });
  fs.writeFileSync(path.join(dir, 'history', 'index.json'), 'garbage');
  fs.writeFileSync(path.join(dir, 'history', `${b.id}.json`), '{broken');
  const log = quietLogger();
  const h2 = createHistoryStore({ dataDir: dir, logger: log });
  assert.deepEqual(h2.listSessions().map((s) => s.id), [a.id]);
  assert.equal(h2.getSession(a.id).title, 'keep me');
  assert.ok(log.warnings.length >= 1);
});

test('onChange fires on changes', () => {
  const h = store();
  let n = 0;
  h.onChange(() => n++);
  const s = h.createSession();
  h.appendMessage(s.id, { role: 'user', text: 'x' });
  h.renameSession(s.id, 'y');
  h.deleteSession(s.id);
  assert.equal(n, 4);
});

test('autoTitle', () => {
  assert.equal(autoTitle({ text: '  hi\n there ' }), 'hi there');
  assert.equal(autoTitle({ text: '', images: [img] }), 'Screenshot');
  assert.equal(autoTitle({ text: 'x'.repeat(100) }).length, 41);
});

test('folders: create, rename, collapse, move chats in and out, persist', () => {
  const dir = tmpDir();
  const h = store(dir);
  const a = h.createSession();
  const b = h.createSession();
  assert.equal(h.listSessions()[0].folderId, null);

  const f = h.createFolder('  Work   stuff ');
  assert.equal(f.name, 'Work stuff');
  assert.equal(f.collapsed, false);
  assert.equal(h.createFolder('').name, 'New folder');

  const moved = h.moveSession(a.id, f.id);
  assert.equal(moved.folderId, f.id);
  assert.deepEqual(h.listSessions().map((s) => s.id), [b.id, a.id], 'moving does not reorder by time');

  assert.equal(h.updateFolder(f.id, { name: 'Work' }).name, 'Work');
  assert.equal(h.updateFolder(f.id, { name: '   ' }).name, 'Work', 'empty rename is ignored');
  assert.equal(h.updateFolder(f.id, { collapsed: true }).collapsed, true);

  const h2 = store(dir);
  assert.deepEqual(h2.listFolders().map((x) => [x.name, x.collapsed]), [['Work', true], ['New folder', false]]);
  assert.equal(h2.listSessions().find((s) => s.id === a.id).folderId, f.id);

  h2.moveSession(a.id, null);
  assert.equal(h2.getSession(a.id).folderId, null);
  assert.throws(() => h2.moveSession(a.id, 'nope'), /Folder not found/);
  assert.throws(() => h2.updateFolder('nope', { name: 'x' }), /Folder not found/);
});

test('deleting a folder keeps its chats at the top level', () => {
  const dir = tmpDir();
  const h = store(dir);
  const a = h.createSession();
  h.appendMessage(a.id, { role: 'user', text: 'keep me' });
  const f = h.createFolder('Temp');
  h.moveSession(a.id, f.id);
  h.deleteFolder(f.id);
  assert.deepEqual(h.listFolders(), []);
  assert.equal(h.listSessions()[0].folderId, null);
  assert.equal(h.getSession(a.id).messages.length, 1);
  const h2 = store(dir);
  assert.equal(h2.listSessions()[0].folderId, null);
  assert.equal(h2.getSession(a.id).folderId, null);
});

test('folder membership survives an index rebuild; folders.json is not read as a chat', () => {
  const dir = tmpDir();
  const h = store(dir);
  const a = h.createSession();
  const f = h.createFolder('Kept');
  h.moveSession(a.id, f.id);
  fs.writeFileSync(path.join(dir, 'history', 'index.json'), '{broken');
  const h2 = store(dir);
  assert.equal(h2.listSessions().length, 1);
  assert.equal(h2.listSessions()[0].folderId, f.id);
  assert.equal(h2.listFolders().length, 1);
});

test('corrupt folders file starts with no folders and chats show at the top level', () => {
  const dir = tmpDir();
  const h = store(dir);
  const a = h.createSession();
  h.moveSession(a.id, h.createFolder('X').id);
  fs.writeFileSync(path.join(dir, 'history', 'folders.json'), 'nope');
  const h2 = store(dir);
  assert.deepEqual(h2.listFolders(), []);
  assert.equal(h2.listSessions()[0].folderId, null);
  assert.equal(h2.getSession(a.id).folderId, null);
});

test('folder changes fire onChange', () => {
  const h = store();
  let n = 0;
  h.onChange(() => { n += 1; });
  const f = h.createFolder('A');
  h.updateFolder(f.id, { collapsed: true });
  h.deleteFolder(f.id);
  assert.equal(n, 3);
});

// ---------------------------------------------------------------------------
// Pins and search (SPEC 9.5.5)
// ---------------------------------------------------------------------------

test('pinned chats list first, latest pin first, and pinning keeps updatedAt', () => {
  const h = store();
  const a = h.createSession();
  const b = h.createSession();
  const c = h.createSession();
  const before = h.listSessions().find((s) => s.id === a.id).updatedAt;
  const pa = h.setPinned(a.id, true);
  assert.equal(pa.pinned, true);
  assert.ok(Number.isFinite(pa.pinnedAt));
  assert.equal(pa.updatedAt, before);
  h.setPinned(b.id, true);
  assert.deepEqual(h.listSessions().map((s) => s.id), [b.id, a.id, c.id]);
  const un = h.setPinned(b.id, false);
  assert.equal(un.pinned, false);
  assert.equal(un.pinnedAt, null);
  assert.deepEqual(h.listSessions().map((s) => s.id), [a.id, c.id, b.id]);
  assert.equal(h.listSessions().find((s) => s.id === c.id).pinned, false);
});

test('pinning again is a no-op; unknown chats throw', () => {
  const h = store();
  const a = h.createSession();
  const first = h.setPinned(a.id, true).pinnedAt;
  assert.equal(h.setPinned(a.id, true).pinnedAt, first);
  assert.throws(() => h.setPinned('nope', true), /not found/);
});

test('pins survive a restart, including a rebuilt index', () => {
  const dir = tmpDir();
  const h = store(dir);
  const a = h.createSession();
  h.createSession();
  h.setPinned(a.id, true);
  const f = h.createFolder('Chem');
  h.updateFolder(f.id, { pinned: true });
  let again = store(dir);
  assert.equal(again.listSessions()[0].id, a.id);
  assert.equal(again.listSessions()[0].pinned, true);
  assert.equal(again.listFolders()[0].pinned, true);
  fs.unlinkSync(path.join(dir, 'history', 'index.json'));
  again = store(dir);
  assert.equal(again.listSessions()[0].id, a.id);
  assert.equal(again.listSessions()[0].pinned, true);
});

test('pinned folders list first (latest pin first), others in creation order', () => {
  const h = store();
  const f1 = h.createFolder('one');
  const f2 = h.createFolder('two');
  const f3 = h.createFolder('three');
  assert.equal(h.listFolders()[0].pinned, false);
  h.updateFolder(f3.id, { pinned: true });
  h.updateFolder(f2.id, { pinned: true });
  assert.deepEqual(h.listFolders().map((f) => f.name), ['two', 'three', 'one']);
  const un = h.updateFolder(f2.id, { pinned: false });
  assert.equal(un.pinnedAt, null);
  assert.deepEqual(h.listFolders().map((f) => f.name), ['three', 'one', 'two']);
  assert.equal(h.updateFolder(f1.id, { name: 'uno' }).pinned, false);
});

function seedSearch(h) {
  const a = h.createSession();
  h.appendMessage(a.id, { role: 'user', text: 'What is the molar mass of water?' });
  h.appendMessage(a.id, { role: 'assistant', answer: '18.02 g/mol', explanation: 'Add 2 x 1.008 for H and 16.00 for O. Water is H2O.' });
  const b = h.createSession();
  h.appendMessage(b.id, { role: 'user', text: 'Balance hydrogen and oxygen to make WATER' });
  h.appendMessage(b.id, { role: 'assistant', answer: '$\\ce{2H2 + O2 -> 2H2O}$', explanation: '' });
  h.appendMessage(b.id, { role: 'assistant', error: 'water error text should not match' });
  h.renameSession(b.id, 'Water reaction');
  return { a, b };
}

test('search is case-insensitive over titles, user text, answers and explanations, newest first', () => {
  const h = store();
  const { a, b } = seedSearch(h);
  const hits = h.search('WaTeR');
  // b is newer: title hit, then its messages newest first; then a (auto title from its question).
  assert.deepEqual(hits.map((x) => [x.sessionId, x.messageId === null ? 'title' : 'msg']),
    [[b.id, 'title'], [b.id, 'msg'], [a.id, 'title'], [a.id, 'msg'], [a.id, 'msg']]);
  assert.equal(hits[0].title, 'Water reaction');
  for (const hit of hits) {
    assert.equal(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength).toLowerCase(), 'water');
    assert.ok(Number.isFinite(hit.updatedAt));
    assert.ok('folderId' in hit);
  }
  // The explanation matched for a's assistant message (answer didn't); one hit per message.
  const aMsgs = h.getSession(a.id).messages;
  assert.deepEqual(hits.filter((x) => x.sessionId === a.id).map((x) => x.messageId), [null, aMsgs[1].id, aMsgs[0].id]);
});

test('search finds answers, ignores errors, respects limit, and empty queries return nothing', () => {
  const h = store();
  const { b } = seedSearch(h);
  assert.equal(h.search('2H2O')[0].sessionId, b.id);
  assert.equal(h.search('error text').length, 0);
  assert.equal(h.search('water', { limit: 2 }).length, 2);
  assert.equal(h.search('water', { limit: 0 }).length, 1);
  assert.equal(h.search('water', { limit: 1e9 }).length, 5);
  assert.deepEqual(h.search(''), []);
  assert.deepEqual(h.search('   '), []);
  assert.deepEqual(h.search(null), []);
  assert.deepEqual(h.search('zebra'), []);
});

test('search snippets are short, one line, and marked with ellipses when cut', () => {
  const h = store();
  const s = h.createSession();
  const long = `${'alpha '.repeat(30)}needle\nin the\nhaystack ${'omega '.repeat(30)}`;
  h.appendMessage(s.id, { role: 'user', text: long });
  const [hit] = h.search('needle');
  assert.ok(hit.snippet.startsWith('…'));
  assert.ok(hit.snippet.endsWith('…'));
  assert.ok(!/\n/.test(hit.snippet));
  assert.ok(hit.snippet.length < 140);
  assert.equal(hit.snippet.substr(hit.matchStart, hit.matchLength), 'needle');
});

test('search reports the folder a chat is in', () => {
  const h = store();
  const s = h.createSession();
  h.appendMessage(s.id, { role: 'user', text: 'stoichiometry' });
  const f = h.createFolder('Chem');
  h.moveSession(s.id, f.id);
  assert.equal(h.search('stoich')[0].folderId, f.id);
});
