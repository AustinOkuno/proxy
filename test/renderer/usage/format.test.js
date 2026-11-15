import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPercent, formatReset, meterModel, parseBudget } from '../../../src/renderer/usage/format.js';

const NOW = new Date(2026, 10, 15, 14, 0, 0).getTime(); // local 14:00
const MIN = 60 * 1000;

const claude = (windows) => ({ provider: 'claude-pro', source: 'claude-cli', windows, today: { requests: 3, inputTokens: 10, outputTokens: 5 }, updatedAt: NOW });
const unknown = [
  { id: 'five_hour', label: 'Next 5 h', used: null, resetsAt: null, status: 'unknown' },
  { id: 'seven_day', label: 'This week', used: null, resetsAt: null, status: 'unknown' },
];
const gemini = (requests, window = {}) => ({
  provider: 'gemini',
  source: 'local-count',
  windows: [{ id: 'day', label: 'Today', used: null, resetsAt: NOW + 10 * 3600 * 1000, status: 'ok', ...window }],
  today: { requests, inputTokens: 100, outputTokens: 20 },
  updatedAt: NOW,
});

test('formatPercent', () => {
  assert.equal(formatPercent(0.423), '42%');
  assert.equal(formatPercent(1.4), '100%');
  assert.equal(formatPercent(null), '?');
});

test('formatReset', () => {
  assert.equal(formatReset(NOW + 25 * MIN, NOW), 'in 25 min');
  assert.equal(formatReset(NOW + 125 * MIN, NOW), 'in 2 h 5 min');
  assert.equal(formatReset(NOW + 120 * MIN, NOW), 'in 2 h');
  assert.equal(formatReset(new Date(2026, 10, 15, 22, 30).getTime(), NOW), 'at 22:30');
  assert.match(formatReset(NOW + 3 * 24 * 3600 * 1000, NOW), /^[A-Z][a-z]{2} 14:00$/);
  assert.equal(formatReset(new Date(2026, 11, 25, 9).getTime(), NOW), '2026-12-25');
  assert.equal(formatReset(NOW - 1, NOW), 'now');
  assert.equal(formatReset(null, NOW), '');
});

test('Claude before the first reply says so instead of guessing', () => {
  const m = meterModel(claude(unknown), {}, NOW);
  assert.equal(m.note, 'Usage shows after your first reply');
  assert.deepEqual(m.bars, []);
  assert.match(m.title, /Claude Code CLI/);
});

test('Claude bars show percent with reset times, or status when there is no utilization', () => {
  const m = meterModel(claude([
    { id: 'five_hour', label: 'Next 5 h', used: 0.42, resetsAt: NOW + 90 * MIN, status: 'ok' },
    { id: 'seven_day', label: 'This week', used: null, resetsAt: NOW + 2 * 24 * 3600 * 1000, status: 'warning' },
  ]), {}, NOW);
  assert.equal(m.note, '');
  assert.deepEqual(m.bars.map((b) => [b.short, b.text, b.status]), [['5h', '42%', 'ok'], ['wk', 'near', 'warning']]);
  assert.match(m.title, /Next 5 h: 42% used, resets in 1 h 30 min/);
  assert.match(m.title, /This week: close to the limit, resets/);
});

test('Gemini shows the count, or used / budget when a budget is set, and the limit after a 429', () => {
  let m = meterModel(gemini(8), { usage: { geminiDailyRequests: null } }, NOW);
  assert.deepEqual(m.bars.map((b) => [b.short, b.text, b.used]), [['today', '8 req', null]]);
  assert.match(m.title, /Set a daily budget/);
  m = meterModel(gemini(8, { used: 0.4 }), { usage: { geminiDailyRequests: 20 } }, NOW);
  assert.equal(m.bars[0].text, '8/20');
  assert.equal(m.bars[0].used, 0.4);
  assert.match(m.title, /8 of your daily budget of 20/);
  m = meterModel(gemini(9, { status: 'limited', resetsAt: NOW + 2 * MIN }), {}, NOW);
  assert.equal(m.bars[0].text, 'limit');
  assert.equal(m.bars[0].status, 'limited');
  assert.match(m.title, /limited until about 2 min/);
});

test('no snapshot yet', () => {
  assert.equal(meterModel(null).note, 'Usage unknown');
});

test('parseBudget', () => {
  const r = { min: 1, max: 100000 };
  assert.equal(parseBudget('', r), null);
  assert.equal(parseBudget('  ', r), null);
  assert.equal(parseBudget('250', r), 250);
  assert.equal(parseBudget('0', r), undefined);
  assert.equal(parseBudget('1.5', r), undefined);
  assert.equal(parseBudget('-3', r), undefined);
  assert.equal(parseBudget('100001', r), undefined);
  assert.equal(parseBudget('abc', r), undefined);
});
