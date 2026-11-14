import test from 'node:test';
import assert from 'node:assert/strict';
import { canSend, createConversation } from '../../src/renderer/lib/conversation.js';

const IMG = { mimeType: 'image/png', dataBase64: 'AAAA' };

/** Fake window.proxy with the stub's behaviour; resolves sends only when told to. */
function fakeApi() {
  const sessions = new Map();
  let n = 0;
  const calls = [];
  const waiting = [];
  return {
    calls,
    sessions,
    release() { waiting.shift()(); },
    get waitingCount() { return waiting.length; },
    chat: {
      send: (req) => {
        calls.push(req);
        return new Promise((resolve, reject) => {
          waiting.push(() => {
            if (fakeApi.failNext) { const e = fakeApi.failNext; fakeApi.failNext = null; return reject(e); }
            let s = req.sessionId && sessions.get(req.sessionId);
            if (!s) { s = { id: `s${++n}`, title: 'x', messages: [] }; sessions.set(s.id, s); }
            const userMessage = { id: `m${++n}`, role: 'user', text: req.text, images: req.images };
            const assistantMessage = { id: `m${++n}`, role: 'assistant', answer: `re: ${req.text}`, explanation: '' };
            s.messages.push(userMessage, assistantMessage);
            resolve({ sessionId: s.id, userMessage, assistantMessage });
          });
        });
      },
    },
    history: {
      get: async (id) => {
        const s = sessions.get(id);
        return s ? { ...s, messages: [...s.messages] } : null;
      },
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

test('canSend needs text or an image', () => {
  assert.equal(canSend({ text: '', images: [] }), false);
  assert.equal(canSend({ text: '   ', images: [] }), false);
  assert.equal(canSend({ text: 'hi', images: [] }), true);
  assert.equal(canSend({ text: '', images: [IMG] }), true);
});

test('first send creates the session, follow-ups reuse it, in order', async () => {
  const api = fakeApi();
  const c = createConversation({ api });
  assert.equal(c.sessionId, null);

  const p1 = c.send({ text: 'first', images: [IMG] });
  const p2 = c.send({ text: 'second' });
  // Both show immediately: user bubble + pending placeholder each.
  assert.deepEqual(c.visibleMessages().map((m) => (m.pending ? 'pending' : m.role)), ['user', 'pending', 'user', 'pending']);
  assert.equal(c.busy, true);

  await tick();
  assert.equal(api.calls.length, 1, 'second send waits for the first');
  assert.equal(api.calls[0].sessionId, null);
  api.release();
  await p1;
  await tick();
  assert.equal(c.sessionId, 's1');
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[1].sessionId, 's1', 'follow-up goes to the session the first send created');
  api.release();
  await p2;

  assert.equal(c.busy, false);
  const msgs = c.visibleMessages();
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(msgs[3].answer, 're: second');
});

test('a failed send becomes an error bubble and does not reject', async () => {
  const api = fakeApi();
  const c = createConversation({ api });
  fakeApi.failNext = new Error('network down');
  const p = c.send({ text: 'hello' });
  await tick();
  api.release();
  assert.equal(await p, null);
  const msgs = c.visibleMessages();
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].text, 'hello');
  assert.match(msgs[1].error, /network down/);
});

test('sending nothing is a no-op', async () => {
  const api = fakeApi();
  const c = createConversation({ api });
  assert.equal(await c.send({ text: '  ', images: [] }), null);
  assert.equal(c.visibleMessages().length, 0);
});

test('open loads a saved session; newChat clears; forget resets the open chat', async () => {
  const api = fakeApi();
  api.sessions.set('s9', { id: 's9', messages: [{ id: 'a', role: 'user', text: 'old' }] });
  let changes = 0;
  const c = createConversation({ api, onChange: () => { changes++; } });
  const opening = c.open('s9');
  assert.equal(c.loading, true);
  await opening;
  assert.equal(c.loading, false);
  assert.equal(c.sessionId, 's9');
  assert.equal(c.visibleMessages()[0].text, 'old');
  assert.ok(changes >= 2);

  c.newChat();
  assert.equal(c.sessionId, null);
  assert.equal(c.visibleMessages().length, 0);

  await c.open('s9');
  c.forget('s9');
  assert.equal(c.sessionId, null);
});

test('opening a missing session falls back to a new chat', async () => {
  const c = createConversation({ api: fakeApi() });
  await c.open('nope');
  assert.equal(c.sessionId, null);
});

test('switching away while a reply is pending keeps it with its own chat', async () => {
  const api = fakeApi();
  api.sessions.set('s9', { id: 's9', messages: [] });
  const c = createConversation({ api });
  const p = c.send({ text: 'q' });
  await c.open('s9');
  await tick();
  api.release();
  await p;
  assert.equal(c.sessionId, 's9');
  assert.equal(c.visibleMessages().length, 0, 'reply did not land in the other chat');
  const newId = [...api.sessions.keys()].find((k) => k !== 's9');
  await c.open(newId);
  assert.deepEqual(c.visibleMessages().map((m) => m.text ?? m.answer), ['q', 're: q']);
});

test('a slow open does not overwrite a later navigation', async () => {
  const api = fakeApi();
  api.sessions.set('a', { id: 'a', messages: [{ id: '1', role: 'user', text: 'A' }] });
  const c = createConversation({ api });
  const slow = c.open('a');
  c.newChat();
  await slow;
  assert.equal(c.sessionId, null);
  assert.equal(c.visibleMessages().length, 0);
});
