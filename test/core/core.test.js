'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCore } = require('../../src/main/core');
const { INVOKE, EVENTS } = require('../../src/shared/contracts');
const { tmpDir, quietLogger } = require('./helpers');

function fakeProviderFactory(impl) {
  const calls = [];
  const factory = (name) => ({
    async generate(args) {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return impl(args);
    },
  });
  return { calls, factory };
}

const makeCore = (impl, dir = tmpDir()) => {
  const fp = fakeProviderFactory(impl);
  return createCore({ dataDir: dir, env: {}, logger: quietLogger(), providerFactory: fp.factory })
    .then((core) => ({ core, calls: fp.calls, dir }));
};

test('chat.send with null session creates one and stores both messages', async () => {
  const { core, calls } = await makeCore(() => ({ answer: 'A', explanation: 'E' }));
  const r = await core.chat.send({ sessionId: null, text: 'hi', images: [] });
  assert.ok(r.sessionId);
  assert.equal(r.userMessage.role, 'user');
  assert.equal(r.assistantMessage.answer, 'A');
  assert.equal(r.assistantMessage.answerStyle, 'both');
  assert.equal(calls[0].name, 'gemini');
  assert.equal(calls[0].args.messages.length, 1);
  const s = core.history.getSession(r.sessionId);
  assert.equal(s.messages.length, 2);
  assert.equal(s.title, 'hi');
});

test('follow-ups send the whole session and use the current answer style', async () => {
  const { core, calls } = await makeCore(() => ({ answer: 'A', explanation: 'E' }));
  const first = await core.chat.send({ sessionId: null, text: 'one', images: [] });
  core.settings.update({ answerStyle: 'explanation' });
  const second = await core.chat.send({ sessionId: first.sessionId, text: 'two', images: [] });
  assert.equal(calls[1].args.messages.length, 3);
  assert.equal(calls[1].args.answerStyle, 'explanation');
  assert.equal(second.assistantMessage.answerStyle, 'explanation');
});

test('model errors become an assistant message with error, not a rejection', async () => {
  const { core } = await makeCore(() => { throw new Error('Gemini API key missing. Add GEMINI_API_KEY to .env and restart.'); });
  const r = await core.chat.send({ sessionId: null, text: '', images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }] });
  assert.match(r.assistantMessage.error, /API key missing/);
  assert.equal(r.assistantMessage.answer, undefined);
  assert.equal(core.history.getSession(r.sessionId).title, 'Screenshot');
});

test('real provider with no key gives the missing-key error bubble', async () => {
  const core = await createCore({ dataDir: tmpDir(), env: {}, logger: quietLogger() });
  const r = await core.chat.send({ sessionId: null, text: 'hi', images: [] });
  assert.equal(r.assistantMessage.error, 'Gemini API key missing. Add GEMINI_API_KEY to .env and restart.');
});

test('empty send is rejected', async () => {
  const { core } = await makeCore(() => ({ answer: 'A', explanation: '' }));
  await assert.rejects(core.chat.send({ sessionId: null, text: '  ', images: [] }));
});

test('unknown sessionId starts a new session', async () => {
  const { core } = await makeCore(() => ({ answer: 'A', explanation: '' }));
  const r = await core.chat.send({ sessionId: 'gone', text: 'x', images: [] });
  assert.notEqual(r.sessionId, 'gone');
  assert.ok(core.history.getSession(r.sessionId));
});

test('history and settings survive a restart', async () => {
  const dir = tmpDir();
  const { core } = await makeCore(() => ({ answer: 'A', explanation: 'E' }), dir);
  const r = await core.chat.send({ sessionId: null, text: 'persist me', images: [] });
  core.settings.update({ sendMode: 'wait' });
  const { core: core2 } = await makeCore(() => ({ answer: '', explanation: '' }), dir);
  assert.equal(core2.history.getSession(r.sessionId).messages.length, 2);
  assert.equal(core2.settings.get().sendMode, 'wait');
});

test('registerIpc handles every Worker 2 channel and emits events', async () => {
  const { core } = await makeCore(() => ({ answer: 'A', explanation: 'E' }));
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const sent = [];
  core.registerIpc(ipcMain, { sendToPanel: (ch, p) => sent.push([ch, p]) });

  for (const ch of ['CHAT_SEND', 'HISTORY_LIST', 'HISTORY_GET', 'HISTORY_CREATE', 'HISTORY_RENAME',
    'HISTORY_DELETE', 'HISTORY_MOVE', 'FOLDER_LIST', 'FOLDER_CREATE', 'FOLDER_UPDATE', 'FOLDER_DELETE',
    'SETTINGS_GET', 'SETTINGS_UPDATE']) {
    assert.equal(typeof handlers[INVOKE[ch]], 'function', ch);
  }

  const s = await handlers[INVOKE.HISTORY_CREATE]({});
  assert.ok(sent.some(([ch]) => ch === EVENTS.HISTORY_CHANGED));
  const r = await handlers[INVOKE.CHAT_SEND]({}, { sessionId: s.id, text: 'q', images: [] });
  assert.equal(r.sessionId, s.id);
  assert.equal((await handlers[INVOKE.HISTORY_GET]({}, { id: s.id })).messages.length, 2);
  assert.equal((await handlers[INVOKE.HISTORY_RENAME]({}, { id: s.id, title: 'T' })).title, 'T');
  assert.equal((await handlers[INVOKE.HISTORY_LIST]({}))[0].title, 'T');
  const f = await handlers[INVOKE.FOLDER_CREATE]({}, { name: 'Work' });
  assert.equal((await handlers[INVOKE.HISTORY_MOVE]({}, { id: s.id, folderId: f.id })).folderId, f.id);
  assert.equal((await handlers[INVOKE.FOLDER_UPDATE]({}, { id: f.id, collapsed: true })).collapsed, true);
  assert.equal((await handlers[INVOKE.FOLDER_UPDATE]({}, { id: f.id, name: 'Jobs' })).name, 'Jobs');
  assert.equal((await handlers[INVOKE.FOLDER_LIST]({}))[0].name, 'Jobs');
  assert.deepEqual(await handlers[INVOKE.FOLDER_DELETE]({}, { id: f.id }), { ok: true });
  assert.equal((await handlers[INVOKE.HISTORY_LIST]({}))[0].folderId, null);
  assert.deepEqual(await handlers[INVOKE.HISTORY_DELETE]({}, { id: s.id }), { ok: true });
  assert.equal((await handlers[INVOKE.HISTORY_LIST]({})).length, 0);

  sent.length = 0;
  const updated = await handlers[INVOKE.SETTINGS_UPDATE]({}, { answerStyle: 'answer' });
  assert.equal(updated.answerStyle, 'answer');
  assert.deepEqual(sent, [[EVENTS.SETTINGS_CHANGED, updated]]);
  assert.equal((await handlers[INVOKE.SETTINGS_GET]({})).answerStyle, 'answer');
});

test('chat.send with retry replaces a failed reply without a new user message', async () => {
  let fail = true;
  const { core, calls } = await makeCore(() => {
    if (fail) throw new Error('Gemini is busy');
    return { answer: 'A', explanation: 'E', model: 'gemini-x' };
  });
  const first = await core.chat.send({ sessionId: null, text: 'q', images: [] });
  assert.match(first.assistantMessage.error, /busy/);

  fail = false;
  const r = await core.chat.send({ sessionId: first.sessionId, retry: true, text: '', images: [] });
  assert.equal(r.assistantMessage.answer, 'A');
  assert.equal(r.assistantMessage.model, 'gemini-x', 'the reply records which model answered');
  assert.equal(r.userMessage.id, first.userMessage.id);
  const s = core.history.getSession(first.sessionId);
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(s.messages[1].answer, 'A');
  assert.equal(calls.at(-1).args.messages.length, 1, 'the model does not see the old error');

  await assert.rejects(core.chat.send({ sessionId: first.sessionId, retry: true }), /nothing to retry/);
  await assert.rejects(core.chat.send({ sessionId: 'gone', retry: true }), /no longer exists/);
});

// ---- Stop ----

/** Provider that waits until its signal aborts (like a hung Gemini call). */
const hangUntilAborted = ({ signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped.'), { stopped: true })));
});

test('chat.cancel stops a send: it resolves with a stopped reply that can be retried', async () => {
  let hang = true;
  const { core } = await makeCore((args) => (hang ? hangUntilAborted(args) : { answer: 'A', explanation: '' }));
  const pending = core.chat.send({ sessionId: null, text: 'q', images: [], requestId: 'r1' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(core.chat.cancel({ requestId: 'r1' }), { ok: true, cancelled: 1 });
  const r = await pending;
  assert.equal(r.assistantMessage.stopped, true);
  assert.equal(r.assistantMessage.error, undefined);
  const saved = core.history.getSession(r.sessionId).messages;
  assert.equal(saved.at(-1).stopped, true, 'the Stopped marker is kept in history');

  hang = false;
  const again = await core.chat.send({ sessionId: r.sessionId, retry: true, requestId: 'r2' });
  assert.equal(again.assistantMessage.answer, 'A');
  assert.deepEqual(core.history.getSession(r.sessionId).messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(core.chat.cancel({ requestId: 'r2' }), { ok: true, cancelled: 0 }, 'finished requests are not cancelled');
});

test('chat.cancel by sessionId, and a cancel that arrives first stops the request at once', async () => {
  let called = 0;
  const { core } = await makeCore((args) => { called += 1; return hangUntilAborted(args); });
  const s = core.history.createSession();
  const pending = core.chat.send({ sessionId: s.id, text: 'q', images: [] });
  await new Promise((r) => setImmediate(r));
  assert.equal(core.chat.cancel({ sessionId: s.id }).cancelled, 1);
  assert.equal((await pending).assistantMessage.stopped, true);

  core.chat.cancel({ requestId: 'early' });
  const r = await core.chat.send({ sessionId: s.id, text: 'q2', images: [], requestId: 'early' });
  assert.equal(r.assistantMessage.stopped, true);
  assert.equal(called, 1, 'the early-cancelled request never reached the model');
});

test('registerIpc handles chat:cancel', async () => {
  const { core } = await makeCore(() => ({ answer: 'A', explanation: '' }));
  const handlers = {};
  core.registerIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, { sendToPanel() {} });
  assert.deepEqual(await handlers[INVOKE.CHAT_CANCEL]({}, { requestId: 'nope' }), { ok: true, cancelled: 0 });
});
