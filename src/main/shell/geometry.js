'use strict';

/**
 * Pure geometry helpers for the shell (no Electron). Unit-tested in test/shell.
 *
 * Coordinate spaces:
 *   - "DIP": Electron's device-independent pixels (screen.getAllDisplays bounds,
 *     overlay mouse coordinates).
 *   - "image px": real pixels of a captured nativeImage.
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/** Build a positive-size rect from two drag points (any direction). */
function rectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Intersect two rects. Returns null if they don't overlap. */
function intersect(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Smallest rect containing all rects. */
function unionRect(rects) {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Map a rect in DIP space (relative to `area`, which is the region the image
 * shows) into integer image pixels, clamped to the image.
 *
 * Uses the real ratio image size / area size rather than display.scaleFactor,
 * so it stays correct if the capturer returned a slightly different size.
 *
 * @param {Rect} rect          relative to area's top-left, in DIP
 * @param {{width:number,height:number}} area   DIP size the image covers
 * @param {{width:number,height:number}} image  image size in px
 * @returns {Rect|null}  null if the result is empty
 */
function scaleRectToImage(rect, area, image) {
  const sx = image.width / area.width;
  const sy = image.height / area.height;
  const x1 = Math.max(0, Math.floor(rect.x * sx));
  const y1 = Math.max(0, Math.floor(rect.y * sy));
  const x2 = Math.min(image.width, Math.ceil((rect.x + rect.width) * sx));
  const y2 = Math.min(image.height, Math.ceil((rect.y + rect.height) * sy));
  if (x2 - x1 < 1 || y2 - y1 < 1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** True if a snip selection is big enough to be deliberate (not a stray click). */
function isUsableSelection(rect, minSize = 4) {
  return !!rect && rect.width >= minSize && rect.height >= minSize;
}

/**
 * Decide where a desktopCapturer image for `display` comes from.
 *
 * On X11, Chromium may give one source per monitor (with display_id set), or a
 * single source for the whole X screen spanning every monitor. This picks the
 * right source and, for the combined case, the DIP area of the display inside it.
 *
 * @param {{ id: string, display_id?: string }[]} sources
 * @param {{ id: number, bounds: Rect }[]} displays   all displays
 * @param {{ id: number, bounds: Rect }} display      the one we want
 * @returns {{ sourceId: string, combined: boolean, area: Rect, crop: Rect|null } | null}
 *   area: DIP rect the source image covers.
 *   crop: DIP rect of `display` relative to area's origin, or null if the
 *         source is exactly this display.
 */
function pickScreenSource(sources, displays, display) {
  if (!sources.length) return null;
  const byId = sources.find((s) => s.display_id && String(s.display_id) === String(display.id));
  if (byId) return { sourceId: byId.id, combined: false, area: display.bounds, crop: null };

  if (sources.length === 1) {
    if (displays.length <= 1) {
      return { sourceId: sources[0].id, combined: false, area: display.bounds, crop: null };
    }
    const area = unionRect(displays.map((d) => d.bounds));
    return {
      sourceId: sources[0].id,
      combined: true,
      area,
      crop: {
        x: display.bounds.x - area.x,
        y: display.bounds.y - area.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
    };
  }

  // Several sources but no display_id match: fall back to display order.
  const idx = displays.findIndex((d) => d.id === display.id);
  const src = sources[idx] || sources[0];
  return { sourceId: src.id, combined: false, area: display.bounds, crop: null };
}

/**
 * Decide the panel's starting bounds. Saved bounds are used only if a usable
 * part of the window (at least 80x40 DIP) is still on some display, so the
 * panel can't open off-screen after a monitor is unplugged.
 *
 * @param {Rect|null} saved
 * @param {Rect[]} workAreas   display work areas (DIP)
 * @param {Rect} primaryWorkArea
 * @param {{width:number,height:number}} defaultSize
 * @returns {Rect}
 */
function initialPanelBounds(saved, workAreas, primaryWorkArea, defaultSize) {
  const valid =
    saved &&
    [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) &&
    saved.width >= 200 &&
    saved.height >= 200;
  if (valid) {
    const visible = workAreas.some((wa) => {
      const i = intersect(saved, wa);
      return i && i.width >= 80 && i.height >= 40;
    });
    if (visible) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }
  const width = Math.min(defaultSize.width, primaryWorkArea.width);
  const height = Math.min(defaultSize.height, primaryWorkArea.height);
  const margin = 24;
  return {
    x: Math.max(primaryWorkArea.x, primaryWorkArea.x + primaryWorkArea.width - width - margin),
    y: Math.max(primaryWorkArea.y, primaryWorkArea.y + primaryWorkArea.height - height - margin),
    width,
    height,
  };
}

/**
 * Validate the overlay page's selection message and map it from viewport px to
 * display DIP (the screenshot is stretched to fill the overlay's viewport).
 * @returns {Rect|null}
 */
function mapSelection(msg, displayWidth, displayHeight) {
  const keys = ['x', 'y', 'width', 'height', 'viewWidth', 'viewHeight'];
  if (!msg || !keys.every((k) => Number.isFinite(msg[k]))) return null;
  if (msg.width <= 0 || msg.height <= 0 || msg.viewWidth <= 0 || msg.viewHeight <= 0) return null;
  const sx = displayWidth / msg.viewWidth;
  const sy = displayHeight / msg.viewHeight;
  return { x: msg.x * sx, y: msg.y * sy, width: msg.width * sx, height: msg.height * sy };
}

module.exports = {
  mapSelection,
  rectFromPoints,
  intersect,
  unionRect,
  scaleRectToImage,
  isUsableSelection,
  pickScreenSource,
  initialPanelBounds,
};
