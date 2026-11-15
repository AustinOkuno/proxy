'use strict';

/**
 * The floating chat panel window: frameless, always on top, docked to a screen
 * corner (top right by default) or free. Dragging it by the title bar and
 * letting go near a corner snaps it there (SPEC 9.2 item 5).
 */

const { app, BrowserWindow, screen } = require('electron');
const { PANEL_DOCKS, SETTINGS_LIMITS, DEFAULT_SETTINGS } = require('../../shared/contracts');
const { initialPanelBounds, dockBounds, workAreaFor, settlePanel, CORNERS } = require('./geometry');

const DEFAULT_SIZE = { width: 420, height: 640 };
const SAVE_DELAY_MS = 500;
// Linux gives no "drag ended" event, so a move or resize counts as finished
// once the window has been still this long.
const SETTLE_MS = 300;
// Moves caused by our own setBounds are not user drags.
const OWN_MOVE_MS = SETTLE_MS + 400;

const DOCK_VALUES = new Set(Object.values(PANEL_DOCKS));

/** The panel prefs from settings, with defaults for anything missing. */
function panelPrefs(settings) {
  const p = (settings && settings.panel) || {};
  const d = DEFAULT_SETTINGS.panel;
  const L = SETTINGS_LIMITS.panelMargin;
  const margin = Number.isFinite(p.margin) ? Math.min(L.max, Math.max(L.min, p.margin)) : d.margin;
  return {
    dock: DOCK_VALUES.has(p.dock) ? p.dock : d.dock,
    snap: typeof p.snap === 'boolean' ? p.snap : d.snap,
    margin,
  };
}

const sameRect = (a, b) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * @param {{
 *   settings: { get(): object, update(patch: object): object },
 *   preloadPath: string,
 *   rendererHtmlPath: string,
 *   onStateChange: (state: object) => void,
 * }} opts
 */
function createPanel({ settings, preloadPath, rendererHtmlPath, onStateChange }) {
  /** @type {BrowserWindow|null} */
  let win = null;
  let saveTimer = null;
  let settleTimer = null;
  let lastSent = '';
  let ownMoveUntil = 0;
  /** Bounds when the last move/resize settled (to tell a move from a resize). */
  let settled = null;
  // The dock lives here as well as in settings: settings only keep `panel`
  // once Worker 2's v3 validation lands, and the panel must work before that.
  let prefs = panelPrefs(settings.get());
  /** The panel prefs as last read from settings. */
  let seen = prefs;

  const alive = () => !!win && !win.isDestroyed();
  const workAreas = () => screen.getAllDisplays().map((d) => d.workArea);
  const primaryArea = () => screen.getPrimaryDisplay().workArea;

  function state() {
    return {
      visible: alive() && win.isVisible(),
      fullscreen: alive() && win.isFullScreen(),
      alwaysOnTop: alive() && win.isAlwaysOnTop(),
      dock: prefs.dock,
      focused: alive() && win.isFocused(),
    };
  }

  function emitState() {
    const s = state();
    const key = JSON.stringify(s);
    if (key === lastSent) return;
    lastSent = key;
    onStateChange(s);
  }

  function canPlace() {
    return alive() && !win.isFullScreen() && !win.isMinimized() && !win.isMaximized();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!canPlace() || !win.isVisible()) return;
      const b = win.getBounds();
      if (sameRect(settings.get().panelBounds, b)) return;
      try {
        settings.update({ panelBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
      } catch (err) {
        console.warn(`[shell] saving panel bounds failed: ${err.message}`);
      }
    }, SAVE_DELAY_MS);
  }

  function saveDock(dock) {
    const saved = settings.get().panel;
    if (saved && saved.dock === dock) return;
    try {
      settings.update({ panel: { dock } });
    } catch (err) {
      console.warn(`[shell] saving the panel dock failed: ${err.message}`);
    }
  }

  /** Move the window ourselves, without it counting as a user drag. */
  function place(bounds) {
    if (!alive()) return;
    const cur = win.getBounds();
    if (sameRect(cur, bounds)) return;
    ownMoveUntil = Date.now() + OWN_MOVE_MS;
    win.setBounds(bounds);
    settled = bounds;
  }

  function currentWorkArea() {
    return workAreaFor(win.getBounds(), workAreas(), primaryArea());
  }

  /** Put a docked panel back in its corner (after a display or margin change). */
  function redock() {
    if (!canPlace() || !CORNERS.includes(prefs.dock)) return;
    const b = win.getBounds();
    place(dockBounds(prefs.dock, b, currentWorkArea(), prefs.margin));
  }

  /**
   * Dock to a corner, or 'free' to stay where it is. Unknown values are ignored.
   * @param {string} dock  PANEL_DOCKS value
   */
  function dock(next) {
    if (!DOCK_VALUES.has(next)) return state();
    prefs = { ...prefs, dock: next };
    if (alive()) {
      if (win.isFullScreen()) win.setFullScreen(false);
      redock();
    }
    saveDock(next);
    emitState();
    return state();
  }

  /** The user stopped dragging or resizing: snap, re-dock, or go free. */
  function onSettle() {
    if (!canPlace()) return;
    const next = win.getBounds();
    const prev = settled;
    settled = next;
    if (Date.now() < ownMoveUntil) return;
    const result = settlePanel({
      prev,
      next,
      dock: prefs.dock,
      snap: prefs.snap,
      workArea: workAreaFor(next, workAreas(), primaryArea()),
      snapDistance: SETTINGS_LIMITS.snapDistance,
      margin: prefs.margin,
    });
    place(result.bounds);
    if (result.dock !== prefs.dock) {
      prefs = { ...prefs, dock: result.dock };
      saveDock(result.dock);
      emitState();
    }
  }

  function onMoveOrResize() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(onSettle, SETTLE_MS);
    scheduleSave();
  }

  /**
   * Settings changed: pick up a new dock, snap or margin. Only a change to the
   * saved `panel` prefs counts, so unrelated saves never move the panel (until
   * Worker 2's v3 validation lands, `panel` always reads as the defaults).
   */
  function applySettings(next) {
    if (!next) return;
    const p = panelPrefs(next);
    const same = p.dock === seen.dock && p.margin === seen.margin && p.snap === seen.snap;
    seen = p;
    if (same) return;
    const move = p.dock !== prefs.dock || p.margin !== prefs.margin;
    prefs = p;
    if (move) {
      redock();
      emitState();
    }
  }

  /** Create the window and load the renderer. Does not show it. */
  async function create() {
    const s = settings.get();
    prefs = panelPrefs(s);
    seen = prefs;
    const bounds = initialPanelBounds(s.panelBounds, workAreas(), primaryArea(), DEFAULT_SIZE, prefs);
    settled = bounds;
    win = new BrowserWindow({
      ...bounds,
      minWidth: 300,
      minHeight: 300,
      title: 'Proxy',
      backgroundColor: '#16171a',
      alwaysOnTop: true,
      resizable: true,
      movable: true,
      fullscreenable: true,
      frame: false, // the renderer draws its own title bar (#titlebar, a drag region)
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    // Linux WMs sometimes drop the hint from the constructor; set it again.
    win.setAlwaysOnTop(true);

    for (const ev of ['show', 'hide', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen', 'always-on-top-changed']) {
      win.on(ev, () => {
        emitState();
        // Some X11 WMs report fullscreen changes late; send the settled state too.
        setTimeout(emitState, 150);
      });
    }
    win.on('leave-full-screen', () => setTimeout(redock, 150));
    win.on('move', onMoveOrResize);
    win.on('resize', onMoveOrResize);
    win.on('closed', () => {
      clearTimeout(saveTimer);
      clearTimeout(settleTimer);
      win = null;
    });

    // A frameless window on Linux has no menu bar, so the default menu's
    // Ctrl+Q may not fire. Keep "quit with Ctrl+Q" working.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && !input.meta &&
          String(input.key).toLowerCase() === 'q') {
        event.preventDefault();
        app.quit();
      }
    });

    // Never let the panel navigate away or open new windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, onDisplaysChanged);
    }

    await win.loadFile(rendererHtmlPath);
  }

  function onDisplaysChanged() {
    if (!canPlace()) return;
    if (CORNERS.includes(prefs.dock)) {
      redock();
      return;
    }
    // A free panel left on an unplugged monitor comes back to the primary one.
    const b = win.getBounds();
    const fixed = initialPanelBounds(b, workAreas(), primaryArea(), DEFAULT_SIZE);
    place(fixed);
  }

  function show() {
    if (!alive()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
  }

  /** Give keyboard focus to the panel's page (showing the panel if needed). */
  function focus() {
    if (!alive()) return;
    show();
    win.webContents.focus();
  }

  /** Give keyboard focus back to whatever had it before (best effort on X11). */
  function blur() {
    if (!alive()) return;
    win.blur();
  }

  function hide() {
    if (!alive()) return;
    // Hiding a fullscreen window on X11 can leave it stuck fullscreen-but-hidden;
    // leave fullscreen first.
    if (win.isFullScreen()) win.setFullScreen(false);
    win.hide();
  }

  function toggleFullscreen() {
    if (!alive()) return state();
    win.setFullScreen(!win.isFullScreen());
    return state();
  }

  function send(channel, payload) {
    if (alive() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }

  function dispose() {
    clearTimeout(saveTimer);
    clearTimeout(settleTimer);
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.removeListener(ev, onDisplaysChanged);
    }
  }

  return {
    create,
    show,
    hide,
    focus,
    blur,
    dock,
    applySettings,
    toggleFullscreen,
    send,
    state,
    dispose,
    isVisible: () => alive() && win.isVisible(),
    isFocused: () => alive() && win.isFocused(),
    get window() {
      return win;
    },
  };
}

module.exports = { createPanel, panelPrefs };
