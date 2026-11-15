import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageToDataUrl, dataUrlToImage, replySections, bubbleKind, formatSessionTime,
} from '../../src/renderer/lib/messages.js';

test('imageToDataUrl / dataUrlToImage round-trip', () => {
  const img = { mimeType: 'image/jpeg', dataBase64: 'QUJD' };
  const url = imageToDataUrl(img);
  assert.equal(url, 'data:image/jpeg;base64,QUJD');
  assert.deepEqual(dataUrlToImage(url), img);
  assert.equal(imageToDataUrl({ dataBase64: 'x' }), 'data:image/png;base64,x');
});

test('dataUrlToImage rejects non-image or unsupported types', () => {
  assert.equal(dataUrlToImage('data:image/gif;base64,QUJD'), null);
  assert.equal(dataUrlToImage('https://example.com/a.png'), null);
  assert.equal(dataUrlToImage(''), null);
});

test('replySections returns only non-empty sections, answer first', () => {
  const both = { role: 'assistant', answer: ' 42 ', explanation: 'because' };
  assert.deepEqual(replySections(both).map((s) => [s.key, s.text]), [['answer', '42'], ['explanation', 'because']]);
  assert.deepEqual(replySections({ role: 'assistant', answer: '', explanation: 'only' }).map((s) => s.key), ['explanation']);
  assert.deepEqual(replySections({ role: 'assistant', answer: 'only', explanation: '' }).map((s) => s.key), ['answer']);
  assert.deepEqual(replySections({ role: 'assistant', error: 'boom', answer: 'x' }), []);
  assert.deepEqual(replySections({ role: 'user', text: 'hi' }), []);
});

test('bubbleKind', () => {
  assert.equal(bubbleKind({ role: 'user', text: 'hi' }), 'user');
  assert.equal(bubbleKind({ role: 'assistant', answer: 'a' }), 'assistant');
  assert.equal(bubbleKind({ role: 'assistant', error: 'no key' }), 'error');
  assert.equal(bubbleKind({ role: 'assistant', pending: true }), 'pending');
  assert.equal(bubbleKind({ role: 'assistant', answer: '', explanation: '' }), 'empty');
});

test('formatSessionTime', () => {
  const now = new Date(2026, 10, 14, 18, 0).getTime();
  assert.equal(formatSessionTime(new Date(2026, 10, 14, 9, 5).getTime(), now), '09:05');
  assert.equal(formatSessionTime(new Date(2026, 2, 3, 9, 5).getTime(), now), 'Mar 3');
  assert.equal(formatSessionTime(new Date(2025, 10, 3).getTime(), now), '2025-11-03');
  assert.equal(formatSessionTime(undefined, now), '');
});

test('a stopped reply gets its own bubble kind', () => {
  assert.equal(bubbleKind({ role: 'assistant', stopped: true }), 'stopped');
  assert.equal(bubbleKind({ role: 'assistant', stopped: true, error: 'x' }), 'error');
  assert.equal(bubbleKind({ role: 'assistant', pending: true, stopping: true }), 'pending');
});

test('explanationCollapsed: a per-reply choice wins over the Ctrl+E state', async () => {
  const { explanationCollapsed } = await import('../../src/renderer/lib/messages.js');
  const o = new Map([['m1', false], ['m2', true]]);
  assert.equal(explanationCollapsed(true, o, 'm1'), false);
  assert.equal(explanationCollapsed(false, o, 'm2'), true);
  assert.equal(explanationCollapsed(true, o, 'm3'), true);
  assert.equal(explanationCollapsed(false, o, undefined), false);
  assert.equal(explanationCollapsed(true, null, 'm1'), true);
});
