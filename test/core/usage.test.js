'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createUsageStore, parseRateLimitEvent, geminiRetryDelayMs, dayKey } = require('../../src/main/core/usage');
const { createStreamParser, createClaudeProvider } = require('../../src/main/core/llm/claude');
const { createGeminiProvider } = require('../../src/main/core/llm/gemini');
const { tmpDir, quietLogger } = require('./helpers');

// Lines in the shape the Claude Code CLI prints with --output-format stream-json
// --verbose (resetsAt in epoch seconds). Field values are made up.
const T0 = Date.UTC(2026, 10, 15, 14, 0, 0); // 2026-11-15 14:00 UTC
const RESET_5H = Math.floor(T0 / 1000) + 2 * 3600;
const RESET_7D = Math.floor(T0 / 1000) + 3 * 86400;
const CLI_LINES = [
  '{"type":"system","subtype":"init","model":"claude-haiku-5-5","session_id":"abc"}',
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":${RESET_5H},"rateLimitType":"five_hour","utilization":0.42,"isUsingOverage":false},"uuid":"u1","session_id":"abc"}`,
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":${RESET_7D},"rateLimitType":"seven_day","utilization":0.91},"uuid":"u2","session_id":"abc"}`,
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":${RESET_7D},"rateLimitType":"seven_day_opus"},"uuid":"u3","session_id":"abc"}`,
  '{"type":"assistant","message":{"model":"claude-haiku-5-5","content":[]}}',
  '{"type":"result","subtype":"success","is_error":false,"result":"{\\"answer\\":\\"A\\",\\"explanation\\":\\"\\"}","usage":{"input_tokens":120,"cache_read_input_tokens":30,"output_tokens":45}}',
];

const clock = (start = T0) => {
  let t = start;
  const now = () => t;
  now.set = (v) => { t = v; };
  now.add = (ms) => { t += ms; };
  return now;
};
const store = (now = clock(), dir = tmpDir()) => createUsageStore({ dataDir: dir, logger: quietLogger(), now });
const CLAUDE = { provider: 'claude-pro' };
const GEMINI = (budget = null) => ({ provider: 'gemini', usage: { geminiDailyRequests: budget } });

// --- parsing ----------------------------------------------------------------

test('parseRateLimitEvent reads recorded CLI lines', () => {
  const parsed = CLI_LINES.map((l) => parseRateLimitEvent(JSON.parse(l)));
  assert.equal(parsed[0], null);
  assert.deepEqual(parsed[1], { type: 'five_hour', status: 'allowed', resetsAt: RESET_5H * 1000, utilization: 0.42 });
  assert.deepEqual(parsed[2], { type: 'seven_day', status: 'allowed_warning', resetsAt: RESET_7D * 1000, utilization: 0.91 });
  assert.deepEqual(parsed[3], { type: 'seven_day_opus', status: 'allowed', resetsAt: RESET_7D * 1000, utilization: null });
  assert.equal(parsed[5], null);
});

test('parseRateLimitEvent handles ms, ISO times, percentages and junk', () => {
  const ev = (info) => ({ type: 'rate_limit_event', rate_limit_info: info });
  assert.equal(parseRateLimitEvent(ev({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: T0 })).resetsAt, T0);
  assert.equal(parseRateLimitEvent(ev({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: '2026-11-15T16:00:00Z' })).resetsAt, Date.UTC(2026, 10, 15, 16));
  assert.equal(parseRateLimitEvent(ev({ status: 'allowed', rateLimitType: 'five_hour', utilization: 55 })).utilization, 0.55);
  assert.equal(parseRateLimitEvent(ev({ status: 'allowed', rateLimitType: 'five_hour' })).resetsAt, null);
  assert.equal(parseRateLimitEvent(ev({ rateLimitType: 'five_hour' })), null);
  assert.equal(parseRateLimitEvent(ev(null)), null);
  assert.equal(parseRateLimitEvent({ type: 'rate_limit_event' }), null);
  assert.equal(parseRateLimitEvent(null), null);
});

test('the Claude stream parser passes each rate limit on as it arrives', () => {
  const seen = [];
  const p = createStreamParser({ onRateLimit: (i) => seen.push(i.type) });
  p.push(`${CLI_LINES.slice(0, 3).join('\n')}\n`);
  assert.deepEqual(seen, ['five_hour', 'seven_day']);
  p.push(`${CLI_LINES.slice(3).join('\n')}\n`);
  const state = p.end();
  assert.deepEqual(seen, ['five_hour', 'seven_day', 'seven_day_opus']);
  assert.equal(state.rateLimits.length, 3);
  assert.ok(state.result);
});

test('a throwing onRateLimit never breaks the stream', () => {
  const p = createStreamParser({ onRateLimit: () => { throw new Error('boom'); } });
  p.push(`${CLI_LINES.join('\n')}\n`);
  assert.ok(p.end().result);
});

test('geminiRetryDelayMs reads the delay from a 429 and falls back to 60 s', () => {
  assert.equal(geminiRetryDelayMs({ message: '{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"17s"}]}}' }), 17000);
  assert.equal(geminiRetryDelayMs({ message: 'Please retry in 4.5s.' }), 4500);
  assert.equal(geminiRetryDelayMs({ message: 'quota exceeded' }), 60000);
  assert.equal(geminiRetryDelayMs(null), 60000);
  assert.equal(geminiRetryDelayMs({ message: '"retryDelay": "999999s"' }), 24 * 3600 * 1000);
});

// --- snapshots --------------------------------------------------------------

test('Claude: unknown before the first reply, honestly', () => {
  const snap = store().snapshot(CLAUDE);
  assert.equal(snap.provider, 'claude-pro');
  assert.equal(snap.source, 'claude-cli');
  assert.deepEqual(snap.windows.map((w) => [w.id, w.label, w.used, w.resetsAt, w.status]), [
    ['five_hour', 'Next 5 h', null, null, 'unknown'],
    ['seven_day', 'This week', null, null, 'unknown'],
  ]);
  assert.equal(snap.updatedAt, null);
  assert.deepEqual(snap.today, { requests: 0, inputTokens: 0, outputTokens: 0 });
});

test('Claude: windows follow the latest rate_limit_event and reset when their time passes', () => {
  const now = clock();
  const u = store(now);
  for (const l of CLI_LINES) {
    const info = parseRateLimitEvent(JSON.parse(l));
    if (info) u.recordClaudeRateLimit(info);
  }
  let snap = u.snapshot(CLAUDE);
  assert.deepEqual(snap.windows.map((w) => [w.id, w.used, w.resetsAt, w.status]), [
    ['five_hour', 0.42, RESET_5H * 1000, 'ok'],
    ['seven_day', 0.91, RESET_7D * 1000, 'warning'],
  ]);
  assert.equal(snap.updatedAt, T0);

  u.recordClaudeRateLimit({ type: 'five_hour', status: 'rejected', resetsAt: RESET_5H * 1000, utilization: null });
  snap = u.snapshot(CLAUDE);
  assert.deepEqual([snap.windows[0].used, snap.windows[0].status], [null, 'limited'], 'status only when there is no utilization');

  now.set(RESET_5H * 1000 + 1);
  snap = u.snapshot(CLAUDE);
  assert.equal(snap.windows[0].status, 'unknown');
  assert.equal(snap.windows[1].status, 'warning');
});

test('Gemini: counts requests and tokens per local day, used / budget when a budget is set', () => {
  const now = clock();
  const u = store(now);
  let snap = u.snapshot(GEMINI());
  assert.equal(snap.source, 'local-count');
  assert.equal(snap.windows.length, 1);
  assert.deepEqual([snap.windows[0].id, snap.windows[0].label, snap.windows[0].used, snap.windows[0].status], ['day', 'Today', null, 'ok']);
  assert.equal(snap.updatedAt, null);

  for (let i = 0; i < 8; i += 1) u.recordRequest('gemini', { inputTokens: 100, outputTokens: 20 });
  snap = u.snapshot(GEMINI());
  assert.deepEqual(snap.today, { requests: 8, inputTokens: 800, outputTokens: 160 });
  assert.equal(snap.windows[0].used, null, 'no budget: count only');
  assert.ok(snap.windows[0].resetsAt > T0, 'resets at local midnight');

  assert.equal(u.snapshot(GEMINI(20)).windows[0].used, 0.4);
  assert.equal(u.snapshot(GEMINI(20)).windows[0].status, 'ok');
  assert.equal(u.snapshot(GEMINI(10)).windows[0].status, 'warning');
  assert.equal(u.snapshot(GEMINI(5)).windows[0].used, 1, 'capped at 1');

  // Next day starts at zero.
  now.add(24 * 3600 * 1000);
  assert.equal(u.snapshot(GEMINI()).today.requests, 0);
});

test('Gemini: a 429 marks it limited until the retry delay', () => {
  const now = clock();
  const u = store(now);
  u.markLimited('gemini', T0 + 30000);
  let w = u.snapshot(GEMINI()).windows[0];
  assert.equal(w.status, 'limited');
  assert.equal(w.resetsAt, T0 + 30000);
  now.add(30001);
  w = u.snapshot(GEMINI()).windows[0];
  assert.equal(w.status, 'ok');
});

test('the snapshot follows the selected provider and its own counts', () => {
  const u = store();
  u.recordRequest('gemini');
  u.recordRequest('claude-pro', { inputTokens: 5, outputTokens: 1 });
  u.addTokens('claude-pro', { inputTokens: 10 });
  assert.equal(u.snapshot(GEMINI()).today.requests, 1);
  assert.deepEqual(u.snapshot(CLAUDE).today, { requests: 1, inputTokens: 15, outputTokens: 1 });
  assert.equal(u.snapshot({}).provider, 'gemini');
  u.recordRequest('openai');
  u.recordClaudeRateLimit({ type: 'weird', status: 'allowed' });
  assert.equal(u.snapshot(CLAUDE).windows[0].status, 'unknown');
});

test('usage persists to usage.json, keeps 14 days, survives a corrupt file', () => {
  const dir = tmpDir();
  const now = clock();
  const u = store(now, dir);
  u.recordRequest('gemini');
  u.recordClaudeRateLimit({ type: 'five_hour', status: 'allowed', resetsAt: RESET_5H * 1000, utilization: 0.2 });
  const again = store(now, dir);
  assert.equal(again.snapshot(GEMINI()).today.requests, 1);
  assert.equal(again.snapshot(CLAUDE).windows[0].used, 0.2);

  const old = dayKey(T0);
  now.add(20 * 24 * 3600 * 1000);
  again.recordRequest('gemini');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
  assert.ok(!(old in onDisk.days), 'old days dropped');
  assert.equal(Object.keys(onDisk.days).length, 1);

  fs.writeFileSync(path.join(dir, 'usage.json'), '{nope');
  const log = quietLogger();
  const fresh = createUsageStore({ dataDir: dir, logger: log, now });
  assert.equal(fresh.snapshot(GEMINI()).today.requests, 0);
  assert.ok(log.warnings.some((w) => /unreadable/.test(w)));
});

test('onChange fires on every change', () => {
  const u = store();
  let n = 0;
  const off = u.onChange(() => { n += 1; });
  u.recordRequest('gemini');
  u.markLimited('gemini', T0 + 1);
  off();
  u.recordRequest('gemini');
  assert.equal(n, 2);
});

// --- providers report to the meter ------------------------------------------

function fakeSpawn(lines) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(_c, _e, cb) { cb(); },
      final(cb) {
        cb();
        setImmediate(() => {
          for (const l of lines) child.stdout.write(`${l}\n`);
          child.stdout.end();
          child.stderr.end();
          setImmediate(() => child.emit('close', 0));
        });
      },
    });
    child.kill = () => {};
    return child;
  };
}

test('the Claude provider records rate limits and the request with its tokens', async () => {
  const u = store();
  const p = createClaudeProvider({
    env: {},
    settings: { get: () => ({ claudeModel: 'haiku' }) },
    spawn: fakeSpawn(CLI_LINES),
    find: () => '/bin/claude',
    shrinkImage: (i) => i,
    makeTempDir: () => '/tmp/x',
    removeDir: () => {},
    logger: quietLogger(),
    usage: u,
  });
  const reply = await p.generate({ messages: [{ role: 'user', text: 'hi' }], answerStyle: 'both' });
  assert.equal(reply.answer, 'A');
  const snap = u.snapshot(CLAUDE);
  assert.equal(snap.windows[0].used, 0.42);
  assert.equal(snap.windows[1].status, 'warning');
  assert.deepEqual(snap.today, { requests: 1, inputTokens: 150, outputTokens: 45 });
});

test('the Gemini provider counts each request, its tokens, and a 429', async () => {
  const now = clock();
  const u = store(now);
  let fail = false;
  const factory = () => ({
    models: {
      async generateContent() {
        if (fail) {
          const e = new Error('{"error":{"code":429,"message":"Resource exhausted","details":[{"retryDelay":"20s"}]}}');
          e.status = 429;
          throw e;
        }
        return { text: '{"answer":"A","explanation":"E"}', usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40 } };
      },
    },
  });
  const p = createGeminiProvider({
    env: { GEMINI_API_KEY: 'k' }, clientFactory: factory, shrinkImage: (i) => i, logger: quietLogger(), now, sleep: async () => {}, usage: u,
  });
  await p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' });
  assert.deepEqual(u.snapshot(GEMINI()).today, { requests: 1, inputTokens: 300, outputTokens: 40 });
  fail = true;
  await assert.rejects(p.generate({ messages: [{ role: 'user', text: 'q' }], answerStyle: 'both' }), /quota|rate limit/i);
  const snap = u.snapshot(GEMINI(10));
  assert.equal(snap.today.requests, 2);
  assert.equal(snap.windows[0].status, 'limited');
  assert.equal(snap.windows[0].resetsAt, T0 + 20000);
});
