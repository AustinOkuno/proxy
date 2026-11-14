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
  assert.deepEqual(reply, { answer: 'Paris', explanation: '' });
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
