'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startWatch, watchStep, RELEASE_DEFAULTS } = require('../../src/main/shell/release');

const B = { x: 10, y: 10, width: 400, height: 600 };
const at = (ms) => ms;
const start = () => startWatch({ bounds: B, cursor: { x: 200, y: 20 }, at: at(0) });

function run(samples) {
  let state = start();
  const out = [];
  for (const s of samples) {
    const step = watchStep(state, s);
    state = step.state;
    out.push(step.decision);
    if (step.decision !== 'wait') break;
  }
  return out;
}

test('a held, still mouse keeps waiting (the pause near a corner)', () => {
  const samples = [50, 100, 150, 200, 400, 800].map((t) => ({ bounds: B, cursor: { x: 201, y: 21 }, at: t }));
  assert.deepEqual(run(samples), ['wait', 'wait', 'wait', 'wait', 'wait', 'wait']);
});

test('the window moving again means the drag goes on', () => {
  const moved = { ...B, x: 30 };
  assert.deepEqual(run([
    { bounds: B, cursor: { x: 220, y: 20 }, at: 50 }, // pointer ahead of the WM for one sample
    { bounds: moved, cursor: { x: 220, y: 20 }, at: 100 },
  ]), ['wait', 'dragging']);
});

test('the pointer leaving a still window is a release, after two samples', () => {
  assert.deepEqual(run([
    { bounds: B, cursor: { x: 200, y: 20 }, at: 50 },
    { bounds: B, cursor: { x: 240, y: 90 }, at: 100 },
    { bounds: B, cursor: { x: 300, y: 160 }, at: 150 },
  ]), ['wait', 'wait', 'released']);
});

test('small jitter is not a release, and resets the count', () => {
  const slop = RELEASE_DEFAULTS.cursorSlop;
  assert.deepEqual(run([
    { bounds: B, cursor: { x: 200 + slop, y: 20 }, at: 50 },
    { bounds: B, cursor: { x: 260, y: 20 }, at: 100 },
    { bounds: B, cursor: { x: 202, y: 20 }, at: 150 },
    { bounds: B, cursor: { x: 260, y: 20 }, at: 200 },
  ]), ['wait', 'wait', 'wait', 'wait']);
});

test('no signal at all is treated as released after maxWaitMs', () => {
  const t = RELEASE_DEFAULTS.maxWaitMs;
  assert.deepEqual(run([
    { bounds: B, cursor: { x: 200, y: 20 }, at: t - 1 },
    { bounds: B, cursor: { x: 200, y: 20 }, at: t },
  ]), ['wait', 'released']);
});
