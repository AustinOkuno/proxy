'use strict';

/**
 * Telling when the user lets go of the mouse after dragging the panel.
 *
 * Linux gives Electron no "drag ended" event: while the window manager moves
 * the window, the app sees only a stream of 'move' events, and a pause looks
 * the same as a release. Snapping on a pause made the panel jump into a corner
 * while the mouse button was still held (SPEC 9.2 item 5 says "releasing a
 * drag").
 *
 * So after the window goes still, Proxy watches the mouse pointer. While the
 * button is held, the window follows the pointer; once the pointer moves and
 * the window stays put, the button has been released. A key press also counts
 * (you can't type into the panel mid-drag), and after `maxWaitMs` with no
 * signal at all the release is assumed, so a drop with a perfectly still mouse
 * still snaps.
 *
 * Pure, no Electron, so it runs under node --test.
 */

const DEFAULTS = Object.freeze({
  /** How far (px, on either axis) the pointer must move without the window. */
  cursorSlop: 6,
  /** Samples in a row that must show the pointer away, so WM lag isn't a release. */
  confirmSamples: 2,
  /** Give up waiting for a signal after this long and treat it as released. */
  maxWaitMs: 2500,
});

const sameRect = (a, b) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Start watching once the window has gone still.
 * @param {{ bounds: object, cursor: { x: number, y: number }, at: number }} sample
 * @returns {{ bounds: object, cursor: { x: number, y: number }, since: number, away: number }}
 */
function startWatch({ bounds, cursor, at }) {
  return { bounds, cursor, since: at, away: 0 };
}

/**
 * Look at one new sample.
 * - 'dragging': the window moved again, so the drag goes on (stop watching;
 *   the next 'move' events start a new settle).
 * - 'released': the pointer moved away from a still window, or time ran out.
 * - 'wait': no sign yet; sample again.
 * @param {ReturnType<typeof startWatch>} state
 * @param {{ bounds: object, cursor: { x: number, y: number }, at: number }} sample
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {{ decision: 'dragging'|'released'|'wait', state: ReturnType<typeof startWatch> }}
 */
function watchStep(state, sample, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!sameRect(state.bounds, sample.bounds)) return { decision: 'dragging', state };
  const dist = Math.max(Math.abs(sample.cursor.x - state.cursor.x), Math.abs(sample.cursor.y - state.cursor.y));
  const away = dist > o.cursorSlop ? state.away + 1 : 0;
  const next = { ...state, away };
  if (away >= o.confirmSamples) return { decision: 'released', state: next };
  if (sample.at - state.since >= o.maxWaitMs) return { decision: 'released', state: next };
  return { decision: 'wait', state: next };
}

module.exports = { startWatch, watchStep, RELEASE_DEFAULTS: DEFAULTS };
