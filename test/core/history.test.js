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
