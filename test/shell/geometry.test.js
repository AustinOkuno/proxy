'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../../src/main/shell/geometry');

test('rectFromPoints works in any drag direction', () => {
  assert.deepEqual(g.rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 2 }), { x: 4, y: 2, width: 6, height: 18 });
  assert.deepEqual(g.rectFromPoints({ x: 1, y: 1 }, { x: 5, y: 9 }), { x: 1, y: 1, width: 4, height: 8 });
});

test('intersect and unionRect', () => {
  assert.equal(g.intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 }), null);
  assert.deepEqual(g.intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), {
    x: 5, y: 5, width: 5, height: 5,
  });
  assert.deepEqual(
    g.unionRect([{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: -200, width: 1280, height: 1024 }]),
    { x: 0, y: -200, width: 3200, height: 1280 },
  );
});

test('scaleRectToImage at scale 1 and 2, clamped', () => {
  const area = { width: 1920, height: 1080 };
  assert.deepEqual(g.scaleRectToImage({ x: 10, y: 20, width: 100, height: 50 }, area, area), {
    x: 10, y: 20, width: 100, height: 50,
  });
  assert.deepEqual(
    g.scaleRectToImage({ x: 10.5, y: 20, width: 100, height: 50 }, area, { width: 3840, height: 2160 }),
    { x: 21, y: 40, width: 200, height: 100 },
  );
  // runs off the edge -> clamped
  assert.deepEqual(g.scaleRectToImage({ x: 1900, y: 1000, width: 100, height: 100 }, area, area), {
    x: 1900, y: 1000, width: 20, height: 80,
  });
  assert.equal(g.scaleRectToImage({ x: 5000, y: 0, width: 10, height: 10 }, area, area), null);
});

test('isUsableSelection rejects tiny selections', () => {
  assert.equal(g.isUsableSelection({ x: 0, y: 0, width: 2, height: 100 }), false);
  assert.equal(g.isUsableSelection({ x: 0, y: 0, width: 10, height: 10 }), true);
  assert.equal(g.isUsableSelection(null), false);
});

test('mapSelection maps viewport px to display DIP and validates', () => {
  assert.deepEqual(
    g.mapSelection({ x: 10, y: 10, width: 100, height: 50, viewWidth: 960, viewHeight: 540 }, 1920, 1080),
    { x: 20, y: 20, width: 200, height: 100 },
  );
  assert.equal(g.mapSelection({ x: 1, y: 1, width: 0, height: 5, viewWidth: 10, viewHeight: 10 }, 10, 10), null);
  assert.equal(g.mapSelection({ x: 'a', y: 1, width: 1, height: 1, viewWidth: 10, viewHeight: 10 }, 10, 10), null);
  assert.equal(g.mapSelection(null, 10, 10), null);
});

const d1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const d2 = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 } };

test('pickScreenSource matches by display_id', () => {
  const sources = [{ id: 'screen:0', display_id: '1' }, { id: 'screen:1', display_id: '2' }];
  const p = g.pickScreenSource(sources, [d1, d2], d2);
  assert.equal(p.sourceId, 'screen:1');
  assert.equal(p.crop, null);
  assert.deepEqual(p.area, d2.bounds);
});

test('pickScreenSource handles one combined X11 source for two monitors', () => {
  const p = g.pickScreenSource([{ id: 'screen:0', display_id: '' }], [d1, d2], d2);
  assert.equal(p.combined, true);
  assert.deepEqual(p.area, { x: 0, y: 0, width: 3200, height: 1080 });
  assert.deepEqual(p.crop, { x: 1920, y: 0, width: 1280, height: 1024 });
});

test('pickScreenSource single monitor, no ids', () => {
  const p = g.pickScreenSource([{ id: 'screen:0' }], [d1], d1);
  assert.equal(p.sourceId, 'screen:0');
  assert.equal(p.crop, null);
});

test('pickScreenSource falls back to display order, and null with no sources', () => {
  const p = g.pickScreenSource([{ id: 'a' }, { id: 'b' }], [d1, d2], d2);
  assert.equal(p.sourceId, 'b');
  assert.equal(g.pickScreenSource([], [d1], d1), null);
});

test('initialPanelBounds keeps visible saved bounds and rejects off-screen ones', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const def = { width: 420, height: 640 };
  const saved = { x: 100, y: 100, width: 500, height: 700 };
  assert.deepEqual(g.initialPanelBounds(saved, [wa], wa, def), saved);

  const offScreen = { x: 5000, y: 100, width: 500, height: 700 };
  const placed = g.initialPanelBounds(offScreen, [wa], wa, def);
  assert.deepEqual(placed, { x: 1920 - 420 - 24, y: 1040 - 640 - 24, width: 420, height: 640 });

  assert.deepEqual(g.initialPanelBounds(null, [wa], wa, def), placed);
  assert.deepEqual(g.initialPanelBounds({ x: NaN, y: 0, width: 500, height: 500 }, [wa], wa, def), placed);
});

test('initialPanelBounds fits the default into a small screen', () => {
  const wa = { x: 0, y: 0, width: 800, height: 500 };
  const b = g.initialPanelBounds(null, [wa], wa, { width: 420, height: 640 });
  assert.equal(b.height, 500);
  assert.equal(b.y, 0);
});
