'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../src/main/shell/visibility');

test('showAtStart', () => {
  assert.equal(v.showAtStart('always'), true);
  assert.equal(v.showAtStart('toggle'), true);
  assert.equal(v.showAtStart('hidden-until-capture'), false);
});

test('toggleAction never hides in always mode', () => {
  assert.equal(v.toggleAction('always', true), 'show');
  assert.equal(v.toggleAction('toggle', true), 'hide');
  assert.equal(v.toggleAction('toggle', false), 'show');
  assert.equal(v.toggleAction('hidden-until-capture', true), 'hide');
});

test('onModeChange shows only when switching to always', () => {
  assert.equal(v.onModeChange('toggle', 'always'), 'show');
  assert.equal(v.onModeChange('always', 'toggle'), null);
  assert.equal(v.onModeChange('always', 'always'), null);
});
