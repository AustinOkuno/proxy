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

// ---------------------------------------------------------------------------
// Docking and snapping
// ---------------------------------------------------------------------------

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 420, height: 640 };

test('dockBounds puts the panel in each corner, margin px from the edges', () => {
  assert.deepEqual(g.dockBounds('top-left', SIZE, WA, 16), { x: 16, y: 16, width: 420, height: 640 });
  assert.deepEqual(g.dockBounds('top-right', SIZE, WA, 16), { x: 1920 - 420 - 16, y: 16, width: 420, height: 640 });
  assert.deepEqual(g.dockBounds('bottom-left', SIZE, WA, 16), { x: 16, y: 1040 - 640 - 16, width: 420, height: 640 });
  assert.deepEqual(g.dockBounds('bottom-right', SIZE, WA, 0), { x: 1500, y: 400, width: 420, height: 640 });
});

test('dockBounds works on a second display with an offset and shrinks to fit', () => {
  const second = { x: 1920, y: -200, width: 1280, height: 600 };
  assert.deepEqual(g.dockBounds('top-right', SIZE, second, 16), {
    x: 1920 + 1280 - 420 - 16, y: -200 + 16, width: 420, height: 600 - 32,
  });
  assert.deepEqual(g.dockBounds('bottom-left', SIZE, second, 16), { x: 1936, y: -200 + 16, width: 420, height: 568 });
});

test('snapCorner picks the corner within the snap distance, or null', () => {
  const near = (corner, dx, dy) => {
    const b = g.dockBounds(corner, SIZE, WA, 16);
    return { ...b, x: b.x + dx, y: b.y + dy };
  };
  assert.equal(g.snapCorner(near('top-right', -30, 40), WA, 48, 16), 'top-right');
  assert.equal(g.snapCorner(near('top-left', 48, 48), WA, 48, 16), 'top-left');
  assert.equal(g.snapCorner(near('bottom-left', 10, -10), WA, 48, 16), 'bottom-left');
  assert.equal(g.snapCorner(near('bottom-right', 5, 5), WA, 48, 16), 'bottom-right'); // past the margin still snaps
  assert.equal(g.snapCorner(near('top-right', -49, 0), WA, 48, 16), null);
  assert.equal(g.snapCorner({ x: 700, y: 200, ...SIZE }, WA, 48, 16), null);
});

test('snapCorner on a second display uses that display', () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1024 };
  const b = { x: 1920 + 20, y: 1024 - 640 - 30, ...SIZE };
  assert.equal(g.snapCorner(b, second, 48, 16), 'bottom-left');
  assert.equal(g.snapCorner(b, WA, 48, 16), null);
});

test('workAreaFor picks the display the panel overlaps most, else the nearest', () => {
  const a = { x: 0, y: 0, width: 1920, height: 1040 };
  const b = { x: 1920, y: 0, width: 1280, height: 1024 };
  assert.equal(g.workAreaFor({ x: 1800, y: 100, ...SIZE }, [a, b], a), b);
  assert.equal(g.workAreaFor({ x: 1600, y: 100, ...SIZE }, [a, b], a), a);
  assert.equal(g.workAreaFor({ x: 5000, y: 100, ...SIZE }, [a, b], a), b);
  assert.equal(g.workAreaFor({ x: NaN, y: 0, ...SIZE }, [a, b], a), a);
});

test('settlePanel: releasing a drag near a corner docks there', () => {
  const prev = g.dockBounds('top-right', SIZE, WA, 16);
  const next = { x: 30, y: 1040 - 640 - 40, ...SIZE };
  const r = g.settlePanel({ prev, next, dock: 'top-right', snap: true, workArea: WA, snapDistance: 48, margin: 16 });
  assert.equal(r.dock, 'bottom-left');
  assert.deepEqual(r.bounds, g.dockBounds('bottom-left', SIZE, WA, 16));
});

test('settlePanel: releasing a drag in the middle goes free and stays put', () => {
  const prev = g.dockBounds('top-right', SIZE, WA, 16);
  const next = { x: 700, y: 200, ...SIZE };
  const r = g.settlePanel({ prev, next, dock: 'top-right', snap: true, workArea: WA, snapDistance: 48, margin: 16 });
  assert.deepEqual(r, { dock: 'free', bounds: next });
});

test('settlePanel: with snapping off a drag near a corner stays free', () => {
  const prev = { x: 700, y: 200, ...SIZE };
  const next = { x: 20, y: 20, ...SIZE };
  const r = g.settlePanel({ prev, next, dock: 'free', snap: false, workArea: WA, snapDistance: 48, margin: 16 });
  assert.deepEqual(r, { dock: 'free', bounds: next });
});

test('settlePanel: resizing a docked panel keeps it in its corner', () => {
  const prev = g.dockBounds('top-right', SIZE, WA, 16);
  // Dragging the left edge outwards: x and width change.
  const next = { x: prev.x - 100, y: prev.y, width: 520, height: 640 };
  const r = g.settlePanel({ prev, next, dock: 'top-right', snap: true, workArea: WA, snapDistance: 48, margin: 16 });
  assert.equal(r.dock, 'top-right');
  assert.deepEqual(r.bounds, g.dockBounds('top-right', { width: 520, height: 640 }, WA, 16));
  // Dragging the right edge of a top-right panel past the margin snaps it back in.
  const wider = { x: prev.x, y: prev.y, width: 450, height: 640 };
  const r2 = g.settlePanel({ prev, next: wider, dock: 'top-right', snap: true, workArea: WA, snapDistance: 48, margin: 16 });
  assert.equal(r2.bounds.x + r2.bounds.width, 1920 - 16);
});

test('settlePanel: resizing a free panel keeps it free and where it is', () => {
  const prev = { x: 700, y: 200, ...SIZE };
  const next = { x: 700, y: 200, width: 500, height: 600 };
  const r = g.settlePanel({ prev, next, dock: 'free', snap: true, workArea: WA, snapDistance: 48, margin: 16 });
  assert.deepEqual(r, { dock: 'free', bounds: next });
});

test('settlePanel: nothing changed keeps the dock', () => {
  const b = g.dockBounds('bottom-right', SIZE, WA, 16);
  assert.deepEqual(
    g.settlePanel({ prev: b, next: b, dock: 'bottom-right', snap: true, workArea: WA, snapDistance: 48, margin: 16 }),
    { dock: 'bottom-right', bounds: b },
  );
});

test('initialPanelBounds opens a docked panel top right by default, keeping the saved size', () => {
  const def = { width: 420, height: 640 };
  assert.deepEqual(
    g.initialPanelBounds(null, [WA], WA, def, { dock: 'top-right', margin: 16 }),
    { x: 1920 - 420 - 16, y: 16, width: 420, height: 640 },
  );
  const saved = { x: 100, y: 100, width: 500, height: 700 };
  assert.deepEqual(
    g.initialPanelBounds(saved, [WA], WA, def, { dock: 'bottom-left', margin: 16 }),
    { x: 16, y: 1040 - 700 - 16, width: 500, height: 700 },
  );
  // Saved on the second display: docks on that display.
  const second = { x: 1920, y: 0, width: 1280, height: 1024 };
  const onSecond = { x: 2000, y: 100, width: 500, height: 700 };
  assert.deepEqual(
    g.initialPanelBounds(onSecond, [WA, second], WA, def, { dock: 'top-left', margin: 16 }),
    { x: 1936, y: 16, width: 500, height: 700 },
  );
  // 'free' keeps the old behaviour.
  assert.deepEqual(g.initialPanelBounds(saved, [WA], WA, def, { dock: 'free', margin: 16 }), saved);
});
