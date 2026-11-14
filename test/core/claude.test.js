'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const path = require('node:path');
const {
  createClaudeProvider,
  buildUserContent,
  buildArgs,
  childEnv,
  findClaude,
  friendlyError,
  NOT_INSTALLED_MESSAGE,
  NOT_LOGGED_IN_MESSAGE,
  MAX_IMAGES,
} = require('../../src/main/core/llm/claude');
const { createProvider } = require('../../src/main/core/llm');

const img = (d = 'AAAA') => ({ mimeType: 'image/png', dataBase64: d });
const quiet = { warn() {} };

/**
 * Fake child_process.spawn. `script(child, input)` runs once stdin is closed;
 * it can write lines to child.stdout and then call child.finish(code).
 */
function fakeSpawn(script) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = [];
    let input = '';
    child.stdin = new Writable({
      write(chunk, _enc, cb) { input += chunk; cb(); },
      final(cb) { cb(); setImmediate(() => script(child, JSON.parse(input))); },
    });
    child.kill = (sig) => { child.killed.push(sig); if (sig === 'SIGTERM') setImmediate(() => child.finish(null)); };
    child.finish = (code) => {
      if (child.done) return;
      child.done = true;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code));
    };
    calls.push({ bin, args, opts, child });
    return child;
  };
  return { spawn, calls };
}

const line = (child, obj) => child.stdout.write(`${JSON.stringify(obj)}\n`);
function answerWith(structured, model = 'claude-haiku-5-5') {
  return (child) => {
    line(child, { type: 'system', subtype: 'init', model });
    line(child, { type: 'assistant', message: { model, content: [] } });
    line(child, { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(structured), structured_output: structured, modelUsage: { [model]: {} } });
    child.finish(0);
  };
}

function makeProvider(spawn, extra = {}) {
  const removed = [];
  const p = createClaudeProvider({
    env: { HOME: '/home/u', PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-secret', GEMINI_API_KEY: 'g-secret' },
    settings: { get: () => ({ claudeModel: extra.model || 'haiku' }) },
    spawn,
    find: () => '/home/u/.local/bin/claude',
    shrinkImage: (i) => i,
    makeTempDir: () => '/tmp/proxy-claude-test',
    removeDir: (d) => removed.push(d),
    logger: quiet,
    ...extra.opts,
  });
  return { p, removed };
}

test('registry creates the claude-pro provider', () => {
  const p = createProvider('claude-pro', { env: {}, settings: { get: () => ({}) } });
  assert.equal(p.name, 'claude-pro');
  assert.equal(p.model, 'Claude (Pro) · haiku');
});

test('args: print mode, stream-json, model, schema, no tools, safe mode, no saved sessions', () => {
  const args = buildArgs({ model: 'sonnet', answerStyle: 'answer' });
  const val = (flag) => args[args.indexOf(flag) + 1];
  assert.ok(args.includes('-p'));
  assert.equal(val('--input-format'), 'stream-json');
  assert.equal(val('--output-format'), 'stream-json');
  assert.equal(val('--model'), 'sonnet');
  assert.equal(val('--tools'), '');
  assert.deepEqual(JSON.parse(val('--json-schema')).required, ['answer', 'explanation']);
  assert.match(val('--system-prompt'), /only wants the answer/);
  for (const f of ['--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands']) assert.ok(args.includes(f), f);
  assert.ok(!args.some((a) => /dangerously|bypass/i.test(a)));
});

test('child env drops API keys so the Pro login is used and secrets stay out', () => {
  const env = childEnv({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'y', GEMINI_API_KEY: 'z', HOME: '/h' }, '/h/.nvm/versions/node/v22/bin/claude');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.HOME, '/h');
  assert.equal(env.PATH.split(path.delimiter)[0], '/h/.nvm/versions/node/v22/bin');
});

test('findClaude honours CLAUDE_PATH and looks in ~/.local/bin when PATH lacks it', () => {
  const ok = new Set(['/home/u/.local/bin/claude', '/opt/c/claude']);
  const isExecutable = (p) => ok.has(p);
  const readdir = () => { throw new Error('no nvm'); };
  assert.equal(findClaude({ HOME: '/home/u', PATH: '/usr/bin' }, { isExecutable, readdir }), '/home/u/.local/bin/claude');
  assert.equal(findClaude({ HOME: '/home/u', CLAUDE_PATH: '/opt/c/claude' }, { isExecutable, readdir }), '/opt/c/claude');
  assert.equal(findClaude({ HOME: '/home/u', CLAUDE_PATH: '/missing/claude' }, { isExecutable, readdir }), null);
  assert.equal(findClaude({ HOME: '/x', PATH: '' }, { isExecutable: () => false, readdir }), null);
});

test('buildUserContent: first message is just the screenshot plus a note', () => {
  const blocks = buildUserContent([{ role: 'user', text: '', images: [img()] }]);
  assert.equal(blocks[0].type, 'image');
  assert.deepEqual(blocks[0].source, { type: 'base64', media_type: 'image/png', data: 'AAAA' });
  assert.match(blocks[1].text, /just the screenshot/);
  assert.equal(blocks.length, 2);
});

test('buildUserContent: follow-ups resend earlier turns and skip failed or stopped replies', () => {
  const blocks = buildUserContent([
    { role: 'user', text: 'what is this', images: [img('OLD')] },
    { role: 'assistant', error: 'boom' },
    { role: 'assistant', stopped: true },
    { role: 'assistant', answer: 'A cat', explanation: 'Fur' },
    { role: 'user', text: 'what colour?' },
  ]);
  const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text);
  assert.equal(texts[0], 'Conversation so far, oldest first:');
  assert.ok(texts.includes('what is this'));
  assert.ok(texts.some((t) => t.includes('"answer":"A cat"')));
  assert.ok(!texts.some((t) => t.includes('boom')));
  assert.equal(texts[texts.length - 2], "The user's new message:");
  assert.equal(texts[texts.length - 1], 'what colour?');
  assert.equal(blocks.filter((b) => b.type === 'image').length, 1);
});

test('buildUserContent keeps only the newest screenshots', () => {
  const msgs = [];
  for (let i = 0; i < MAX_IMAGES + 3; i++) {
    msgs.push({ role: 'user', text: `q${i}`, images: [img(`I${i}`)] }, { role: 'assistant', answer: 'a', explanation: '' });
  }
  msgs.push({ role: 'user', text: 'last', images: [img('NEW')] });
  const blocks = buildUserContent(msgs);
  const images = blocks.filter((b) => b.type === 'image').map((b) => b.source.data);
  assert.equal(images.length, MAX_IMAGES);
  assert.equal(images[images.length - 1], 'NEW');
  assert.ok(!images.includes('I0'));
  assert.ok(blocks.some((b) => b.type === 'text' && /not included/.test(b.text)));
});

test('generate runs claude in a temp dir, sends one stream-json user message and parses the reply', async () => {
  const fake = fakeSpawn(answerWith({ answer: ' Paris ', explanation: 'Capital.' }));
  const { p, removed } = makeProvider(fake.spawn, { model: 'sonnet' });
  const reply = await p.generate({ messages: [{ role: 'user', text: 'Capital of France?', images: [img()] }], answerStyle: 'both' });
  assert.deepEqual(reply, { answer: 'Paris', explanation: 'Capital.', model: 'Claude (Pro) · claude-haiku-5-5' });
  const { bin, args, opts } = fake.calls[0];
  assert.equal(bin, '/home/u/.local/bin/claude');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(opts.cwd, '/tmp/proxy-claude-test');
  assert.equal(opts.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(opts.env.GEMINI_API_KEY, undefined);
  assert.deepEqual(removed, ['/tmp/proxy-claude-test']);
});

test('the reply is sent to stdin as a single user message with the image', async () => {
  let seen;
  const fake = fakeSpawn((child, input) => { seen = input; answerWith({ answer: 'x', explanation: '' })(child); });
  const { p } = makeProvider(fake.spawn);
  await p.generate({ messages: [{ role: 'user', text: 'hi', images: [img()] }], answerStyle: 'answer' });
  assert.equal(seen.type, 'user');
  assert.equal(seen.message.role, 'user');
  assert.deepEqual(seen.message.content.map((b) => b.type), ['image', 'text']);
});

test('answer style is enforced and plain-text results still work', async () => {
  const fake = fakeSpawn((child) => {
    line(child, { type: 'result', subtype: 'success', is_error: false, result: 'Just text' });
    child.finish(0);
  });
  const { p } = makeProvider(fake.spawn);
  const reply = await p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'explanation' });
  assert.equal(reply.answer, '');
  assert.equal(reply.explanation, 'Just text');
  assert.equal(reply.model, 'Claude (Pro) · haiku');
});

test('Stop kills the claude process and rejects with stopped', async () => {
  const fake = fakeSpawn(() => { /* never answers */ });
  const { p } = makeProvider(fake.spawn, { opts: { killGraceMs: 10 } });
  const ctl = new AbortController();
  const pending = p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both', signal: ctl.signal });
  await new Promise((r) => setImmediate(r));
  ctl.abort();
  await assert.rejects(pending, (err) => err.stopped === true);
  assert.deepEqual(fake.calls[0].child.killed, ['SIGTERM']);
});

test('the deadline kills a hung claude process with a readable error', async () => {
  const fake = fakeSpawn(() => { /* never answers */ });
  const { p } = makeProvider(fake.spawn, { opts: { deadlineMs: 20, killGraceMs: 10 } });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' }), /didn't answer within/);
  assert.ok(fake.calls[0].child.killed.includes('SIGTERM'));
});

test('missing CLI gives install steps', async () => {
  const { p } = makeProvider(() => { throw new Error('should not spawn'); }, { opts: { find: () => null } });
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' }), { message: NOT_INSTALLED_MESSAGE });
  assert.match(NOT_INSTALLED_MESSAGE, /install\.sh/);
  assert.match(NOT_INSTALLED_MESSAGE, /claude auth login/);
});

test('spawn ENOENT also gives install steps', async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
    return child;
  };
  const { p } = makeProvider(spawn);
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' }), { message: NOT_INSTALLED_MESSAGE });
});

test('not logged in shows login steps', async () => {
  const fake = fakeSpawn((child) => {
    line(child, { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    child.finish(1);
  });
  const { p } = makeProvider(fake.spawn);
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' }), { message: NOT_LOGGED_IN_MESSAGE });
});

test('exit without a result uses stderr', async () => {
  const fake = fakeSpawn((child) => {
    child.stderr.write("error: unknown option '--safe-mode'\n");
    child.finish(1);
  });
  const { p } = makeProvider(fake.spawn);
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' }), /claude update/);
});

test('friendlyError maps the common CLI failures', () => {
  assert.equal(friendlyError('Invalid API key · Please run /login'), NOT_LOGGED_IN_MESSAGE);
  assert.match(friendlyError("Claude AI usage limit reached|1700000000"), /usage limit/);
  assert.match(friendlyError("There's an issue with the selected model (opus). It may not exist or you may not have access to it. (404)"), /another Claude model/);
  assert.match(friendlyError('API Error: 529 Overloaded'), /busy/);
  assert.match(friendlyError('weird'), /^Claude error: weird/);
});
