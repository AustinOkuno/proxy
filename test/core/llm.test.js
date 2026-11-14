'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContents, parseReply, applyStyle, systemInstruction } = require('../../src/main/core/llm/prompt');
const { createGeminiProvider, friendlyError, MISSING_KEY_MESSAGE, DEFAULT_MODEL, FALLBACK_MODELS } = require('../../src/main/core/llm/gemini');
const { createProvider } = require('../../src/main/core/llm');

const img = { mimeType: 'image/png', dataBase64: 'AAAA' };

function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    factory: (key) => ({
      key,
      models: {
        async generateContent(params) {
          calls.push({ key, params });
          return respond(params);
        },
      },
    }),
  };
}

test('buildContents maps roles, images, drops errors and merges same-role turns', () => {
  const contents = buildContents([
    { role: 'user', text: 'first', images: [img] },
    { role: 'assistant', error: 'boom' },
    { role: 'user', text: 'second' },
    { role: 'assistant', answer: 'A', explanation: 'E' },
    { role: 'user', text: '', images: [img] },
  ]);
  assert.equal(contents.length, 3);
  assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(contents[0].parts, [
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    { text: 'first' },
    { text: 'second' },
  ]);
  assert.deepEqual(JSON.parse(contents[1].parts[0].text), { answer: 'A', explanation: 'E' });
  assert.deepEqual(contents[2].parts, [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }]);
});

test('parseReply handles JSON, fenced JSON and plain text', () => {
  assert.deepEqual(parseReply('{"answer":" 42 ","explanation":"because"}'), { answer: '42', explanation: 'because' });
  assert.deepEqual(parseReply('```json\n{"answer":"x","explanation":"y"}\n```'), { answer: 'x', explanation: 'y' });
  assert.deepEqual(parseReply('just text'), { answer: 'just text', explanation: '' });
  assert.deepEqual(parseReply('[1,2]'), { answer: '[1,2]', explanation: '' });
});

test('applyStyle enforces the answer style', () => {
  const r = { answer: 'A', explanation: 'E' };
  assert.deepEqual(applyStyle(r, 'answer'), { answer: 'A', explanation: '' });
  assert.deepEqual(applyStyle(r, 'explanation'), { answer: '', explanation: 'E' });
  assert.deepEqual(applyStyle(r, 'both'), r);
  assert.deepEqual(applyStyle({ answer: '', explanation: 'E' }, 'answer'), { answer: 'E', explanation: '' });
});

test('systemInstruction mentions the style', () => {
  assert.match(systemInstruction('answer'), /only wants the answer/);
  assert.match(systemInstruction('explanation'), /only wants the explanation/);
});

test('missing key throws the spec message and never calls the SDK', async () => {
  const fake = fakeClient(() => ({ text: '{}' }));
  const p = createGeminiProvider({ env: {}, clientFactory: fake.factory });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'hi' }], answerStyle: 'both' }),
    { message: MISSING_KEY_MESSAGE });
  assert.equal(fake.calls.length, 0);
});

test('gemini adapter sends model, schema and contents, and splits the reply', async () => {
  const fake = fakeClient(() => ({ text: '{"answer":"Paris","explanation":"It is the capital."}' }));
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-test' }, clientFactory: fake.factory });
  const reply = await p.generate({ messages: [{ role: 'user', text: 'Capital of France?', images: [img] }], answerStyle: 'answer' });
  assert.deepEqual(reply, { answer: 'Paris', explanation: '', model: 'gemini-test' });
  const { key, params } = fake.calls[0];
  assert.equal(key, 'k');
  assert.equal(params.model, 'gemini-test');
  assert.equal(params.config.responseMimeType, 'application/json');
  assert.deepEqual(params.config.responseSchema.required, ['answer', 'explanation']);
  assert.equal(params.contents[0].role, 'user');
});

test('default model is a current Flash model, not the restricted 2.5 line', () => {
  const { model } = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' } });
  assert.equal(model, DEFAULT_MODEL);
  assert.doesNotMatch(model, /^gemini-2\./);
});

test('a model the key cannot use falls back to the next model and remembers it', async () => {
  const fake = fakeClient((params) => {
    if (params.model === 'gemini-2.5-flash') { const e = new Error('models/gemini-2.5-flash is not found'); e.status = 404; throw e; }
    if (params.model === DEFAULT_MODEL) { const e = new Error('Quota exceeded for metric: free_tier_requests, limit: 0'); e.status = 429; throw e; }
    return { text: '{"answer":"ok","explanation":""}' };
  });
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-flash' }, clientFactory: fake.factory });
  const reply = await p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both' });
  assert.equal(reply.answer, 'ok');
  assert.deepEqual(fake.calls.map((c) => c.params.model), ['gemini-2.5-flash', DEFAULT_MODEL, FALLBACK_MODELS[0]]);
  assert.equal(p.model, FALLBACK_MODELS[0]);
  await p.generate({ messages: [{ role: 'user', text: 'y' }], answerStyle: 'both' });
  assert.equal(fake.calls[3].params.model, FALLBACK_MODELS[0]);
});

test('when no model is available the 404 message names a model to use', async () => {
  const fake = fakeClient(() => { const e = new Error('not found'); e.status = 404; throw e; });
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both' }),
    new RegExp(`GEMINI_MODEL=${DEFAULT_MODEL}`));
  assert.equal(fake.calls.length, 1 + FALLBACK_MODELS.length);
});

test('an ordinary rate limit does not switch models', async () => {
  const fake = fakeClient(() => { const e = new Error('Resource exhausted, retry in 20s'); e.status = 429; throw e; });
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both' }), /rate limit/);
  assert.equal(fake.calls.length, 1);
});

test('SDK errors become readable messages without the key', async () => {
  const fake = fakeClient(() => { const e = new Error('quota exceeded for secretkey'); e.status = 429; throw e; });
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'secretkey' }, clientFactory: fake.factory });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both' }), /quota/);
  assert.match(friendlyError(new TypeError('fetch failed')), /internet/);
  assert.doesNotMatch(friendlyError(new Error('bad secretkey here'), 'secretkey'), /secretkey/);
});

test('empty model response is an error', async () => {
  const fake = fakeClient(() => ({ text: '' }));
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both' }), /empty/);
});

test('createProvider knows gemini and rejects unknown names', () => {
  assert.equal(createProvider('gemini', { env: {} }).name, 'gemini');
  assert.throws(() => createProvider('nope', {}), /Unknown/);
});

// ---- Retries, temporary fallback and image shrinking ----

const { STICKY_FALLBACK_MS, RETRY_DELAYS_MS, STOPPED_MESSAGE, DEADLINE_MS, deadlineMessage } = require('../../src/main/core/llm/gemini');
const { createImageShrinker } = require('../../src/main/core/llm/images');

function httpError(status, message = `HTTP ${status}`) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Provider with a fake clock: sleeps advance time instantly. */
function retryProvider(respond, env = {}) {
  const fake = fakeClient(respond);
  const clock = { t: 0, sleeps: [] };
  const p = createGeminiProvider({
    env: { GEMINI_API_KEY: 'k', ...env },
    clientFactory: fake.factory,
    sleep: async (ms) => { clock.sleeps.push(ms); clock.t += ms; },
    now: () => clock.t,
    logger: { warn() {} },
  });
  return { p, fake, clock };
}

const ask = (p) => p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both' });
const OK = { text: '{"answer":"ok","explanation":""}' };

test('a 503 is retried on the same model after a short wait', async () => {
  let n = 0;
  const { p, fake, clock } = retryProvider(() => { if (n++ === 0) throw httpError(503); return OK; });
  assert.equal((await ask(p)).answer, 'ok');
  assert.deepEqual(fake.calls.map((c) => c.params.model), [DEFAULT_MODEL, DEFAULT_MODEL]);
  assert.deepEqual(clock.sleeps, [RETRY_DELAYS_MS[0]]);
});

test('repeated 5xx falls back to the lite model and stays there for a while', async () => {
  const { p, fake, clock } = retryProvider((params) => {
    if (params.model === DEFAULT_MODEL) throw httpError(504);
    return OK;
  });
  assert.equal((await ask(p)).answer, 'ok');
  const models = fake.calls.map((c) => c.params.model);
  assert.deepEqual(models, [...Array(RETRY_DELAYS_MS.length + 1).fill(DEFAULT_MODEL), FALLBACK_MODELS[0]]);
  assert.equal(p.model, DEFAULT_MODEL, 'a temporary fallback does not change the configured model');
  assert.equal((await ask(p)).model, FALLBACK_MODELS[0], 'the reply says which model answered');

  assert.equal(fake.calls.at(-1).params.model, FALLBACK_MODELS[0], 'next message goes straight to the fallback');
  assert.equal(fake.calls.length, models.length + 1);

  clock.t += STICKY_FALLBACK_MS;
  await ask(p).catch(() => {});
  assert.equal(fake.calls[models.length + 1].params.model, DEFAULT_MODEL, 'tries the main model again later');
});

test('errors that are not temporary are not retried', async () => {
  const { p, fake, clock } = retryProvider(() => { throw httpError(400, 'Invalid argument'); });
  await assert.rejects(ask(p), /Gemini error/);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(clock.sleeps, []);
});

test('when every model keeps failing the error says retries happened', async () => {
  const { p } = retryProvider(() => { throw httpError(503); });
  await assert.rejects(ask(p), /HTTP 503\), even after retrying/);
});

function fakeNativeImage() {
  const made = [];
  const img = (w, h, bytes) => ({
    isEmpty: () => false,
    getSize: () => ({ width: w, height: h }),
    resize: ({ width, height }) => { made.push([width, height]); return img(width, height, 1000); },
    toPNG: () => Buffer.alloc(bytes),
    toJPEG: () => Buffer.alloc(10),
  });
  return {
    made,
    createFromBuffer: (buf) => {
      const [w, h] = buf.toString().split('x').map(Number);
      return img(w, h, buf.length);
    },
  };
}

const b64 = (s) => Buffer.from(s).toString('base64');

test('big screenshots are scaled down before upload, small ones are left alone', () => {
  const ni = fakeNativeImage();
  const shrink = createImageShrinker({ nativeImage: ni, maxSide: 2048 });
  const small = { mimeType: 'image/png', dataBase64: b64('800x600') };
  assert.equal(shrink(small), small);
  const big = shrink({ mimeType: 'image/png', dataBase64: b64('3840x2160') });
  assert.deepEqual(ni.made, [[2048, 1152]]);
  assert.equal(big.mimeType, 'image/png');
  assert.equal(big.width, 2048);
  shrink({ mimeType: 'image/png', dataBase64: b64('3840x2160') });
  assert.equal(ni.made.length, 1, 'cached');
});

test('without Electron the shrinker passes images through', () => {
  const img = { mimeType: 'image/png', dataBase64: 'AAAA' };
  assert.equal(createImageShrinker({ nativeImage: null })(img), img);
});

// ---- Stop and deadline ----

/** Client whose calls hang until their abortSignal fires (or forever if ignoreAbort). */
function hangingClient({ ignoreAbort = false } = {}) {
  return fakeClient((params) => new Promise((_resolve, reject) => {
    const signal = params.config && params.config.abortSignal;
    if (ignoreAbort || !signal) return;
    signal.addEventListener('abort', () => {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  }));
}

const quiet = { warn() {} };

test('aborting the signal stops a request in flight and passes the signal to the SDK', async () => {
  const fake = hangingClient();
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory, logger: quiet });
  const ctl = new AbortController();
  const pending = p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both', signal: ctl.signal });
  await new Promise((r) => setImmediate(r));
  assert.ok(fake.calls[0].params.config.abortSignal instanceof AbortSignal);
  ctl.abort();
  await assert.rejects(pending, (err) => err.stopped === true && err.message === STOPPED_MESSAGE);
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.calls.length, 1, 'no retries after Stop');
});

test('Stop works even if the SDK ignores the abort', async () => {
  const fake = hangingClient({ ignoreAbort: true });
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory, logger: quiet });
  const ctl = new AbortController();
  const pending = p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both', signal: ctl.signal });
  await new Promise((r) => setImmediate(r));
  ctl.abort();
  await assert.rejects(pending, (err) => err.stopped === true);
});

test('Stop during the wait before a retry cancels the retry', async () => {
  const fake = fakeClient(() => { throw httpError(503); });
  let sleeping;
  const p = createGeminiProvider({
    env: { GEMINI_API_KEY: 'k' },
    clientFactory: fake.factory,
    sleep: () => new Promise((r) => { sleeping = r; }),
    logger: quiet,
  });
  const ctl = new AbortController();
  const pending = p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both', signal: ctl.signal });
  await new Promise((r) => setImmediate(r));
  assert.ok(sleeping, 'waiting to retry');
  ctl.abort();
  await assert.rejects(pending, (err) => err.stopped === true);
  sleeping();
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.calls.length, 1, 'the retry never happened');
});

test('an already-aborted signal never calls the SDK', async () => {
  const fake = hangingClient();
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory, logger: quiet });
  await assert.rejects(
    p.generate({ messages: [{ role: 'user', text: 'x' }], answerStyle: 'both', signal: AbortSignal.abort() }),
    (err) => err.stopped === true,
  );
  assert.equal(fake.calls.length, 0);
});

test('a request that hangs past the deadline fails with a clear message', async () => {
  const fake = hangingClient({ ignoreAbort: true });
  const p = createGeminiProvider({ env: { GEMINI_API_KEY: 'k' }, clientFactory: fake.factory, logger: quiet, deadlineMs: 30 });
  await assert.rejects(ask(p), (err) => !err.stopped && /didn't answer within 1 second.*Retry/.test(err.message));
});

test('the default deadline is a few minutes at most', () => {
  assert.ok(DEADLINE_MS >= 60_000 && DEADLINE_MS <= 5 * 60_000);
  assert.match(deadlineMessage(DEADLINE_MS), /within 2\.5 minutes/);
});
