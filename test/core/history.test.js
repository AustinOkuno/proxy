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
