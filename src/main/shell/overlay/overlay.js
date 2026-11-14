'use strict';

/**
 * Snip overlay window (main side). Shows a frozen screenshot of one display,
 * lets the user drag a rectangle, resolves with that rectangle.
 *
 * IPC is scoped to the overlay's own webContents.ipc and uses only `overlay:`
 * channels, so nothing leaks into the panel's channel space.
 */

const path = require('node:path');
const { BrowserWindow } = require('electron');
const { mapSelection } = require('../geometry');

const SHOW_TIMEOUT_MS = 3000;

/**
 * @param {Electron.Display} display
 * @param {Electron.NativeImage} image   screenshot of that display
 * @returns {{ result: Promise<{x:number,y:number,width:number,height:number}|null>, close: () => void }}
 *   result resolves with a DIP rect relative to the display, or null if cancelled.
 */
function openOverlay(display, image) {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#000000',
    title: 'Proxy snip',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  let settle;
  const result = new Promise((resolve) => {
    settle = resolve;
  });
  let done = false;

  function finish(value) {
    if (done) return;
    done = true;
    settle(value);
    if (!win.isDestroyed()) {
      // Leave fullscreen and hide before destroying so the WM doesn't animate.
      win.hide();
      win.destroy();
    }
  }

  function reveal() {
    if (win.isDestroyed() || win.isVisible()) return;
    win.setBounds({ x, y, width, height });
    win.show();
    // Cover Cinnamon's panels too.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setFullScreen(true);
    win.focus();
    win.webContents.focus();
  }

  const ipc = win.webContents.ipc;
  ipc.handle('overlay:get-image', () => ({
    // JPEG is only the backdrop; the crop comes from the original image.
    imageUrl: `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`,
    width,
    height,
  }));
  ipc.on('overlay:ready', reveal);
  ipc.on('overlay:cancel', () => finish(null));
  ipc.on('overlay:select', (_e, msg) => finish(mapSelection(msg, width, height)));

  win.on('closed', () => finish(null));
  win.webContents.on('render-process-gone', () => finish(null));

  // If the page never reports ready, show it anyway so the user can cancel.
  setTimeout(reveal, SHOW_TIMEOUT_MS);

  win.loadFile(path.join(__dirname, 'overlay.html')).catch((err) => {
    console.warn(`[shell] overlay failed to load: ${err.message}`);
    finish(null);
  });

  return { result, close: () => finish(null) };
}

module.exports = { openOverlay };
