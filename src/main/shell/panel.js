'use strict';

/**
 * The floating chat panel window.
 */

const { BrowserWindow, screen } = require('electron');
const { initialPanelBounds } = require('./geometry');

const DEFAULT_SIZE = { width: 420, height: 640 };
const SAVE_DELAY_MS = 500;

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
  let lastSent = '';

  const alive = () => !!win && !win.isDestroyed();

  function state() {
    return {
      visible: alive() && win.isVisible(),
      fullscreen: alive() && win.isFullScreen(),
      alwaysOnTop: alive() && win.isAlwaysOnTop(),
    };
  }

  function emitState() {
    const s = state();
    const key = JSON.stringify(s);
    if (key === lastSent) return;
    lastSent = key;
    onStateChange(s);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!alive() || win.isFullScreen() || win.isMinimized() || !win.isVisible()) return;
      const b = win.getBounds();
      const prev = settings.get().panelBounds;
      if (prev && prev.x === b.x && prev.y === b.y && prev.width === b.width && prev.height === b.height) return;
      try {
        settings.update({ panelBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
      } catch (err) {
        console.warn(`[shell] saving panel bounds failed: ${err.message}`);
      }
    }, SAVE_DELAY_MS);
  }

  /** Create the window and load the renderer. Does not show it. */
  async function create() {
    const displays = screen.getAllDisplays();
    const bounds = initialPanelBounds(
      settings.get().panelBounds,
      displays.map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea,
      DEFAULT_SIZE,
    );
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
      frame: true,
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

    for (const ev of ['show', 'hide', 'enter-full-screen', 'leave-full-screen', 'always-on-top-changed']) {
      win.on(ev, () => {
        emitState();
        // Some X11 WMs report fullscreen changes late; send the settled state too.
        setTimeout(emitState, 150);
      });
    }
    win.on('move', scheduleSave);
    win.on('resize', scheduleSave);
    win.on('closed', () => {
      clearTimeout(saveTimer);
      win = null;
    });

    // Never let the panel navigate away or open new windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    await win.loadFile(rendererHtmlPath);
  }

  function show() {
    if (!alive()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
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
  }

  return {
    create,
    show,
    hide,
    toggleFullscreen,
    send,
    state,
    dispose,
    isVisible: () => alive() && win.isVisible(),
    get window() {
      return win;
    },
  };
}

module.exports = { createPanel };
