'use strict';

/**
 * Shell: global hotkeys, screen capture (region snip + full screen), panel and
 * overlay window management. OWNER: Worker 1.
 *
 * STUB from the scaffold: opens the panel window and nothing else. Worker 1
 * replaces the internals; the exported shape must keep matching SPEC.md
 * section "Main-process module interfaces".
 */

const { BrowserWindow, globalShortcut, clipboard } = require('electron');
const { INVOKE, EVENTS } = require('../../shared/contracts');

/**
 * @param {{
 *   settings: { get(): object, update(patch: object): object, onChange(cb: Function): Function },
 *   preloadPath: string,
 *   rendererHtmlPath: string,
 * }} opts
 */
async function createShell({ settings, preloadPath, rendererHtmlPath }) {
  let panel = null;

  function windowState() {
    return {
      visible: !!panel && panel.isVisible(),
      fullscreen: !!panel && panel.isFullScreen(),
      alwaysOnTop: !!panel && panel.isAlwaysOnTop(),
    };
  }

  function sendToPanel(channel, payload) {
    if (panel && !panel.isDestroyed()) panel.webContents.send(channel, payload);
  }

  function showPanel() {
    if (!panel) return;
    panel.show();
    panel.focus();
  }

  async function start() {
    const bounds = settings.get().panelBounds || { width: 420, height: 640 };
    panel = new BrowserWindow({
      ...bounds,
      title: 'Proxy',
      backgroundColor: '#16171a',
      alwaysOnTop: true,
      frame: true,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    panel.once('ready-to-show', () => panel.show());
    await panel.loadFile(rendererHtmlPath);
  }

  function registerIpc(ipcMain) {
    const notYet = (what) => () => {
      sendToPanel(EVENTS.CAPTURE_ERROR, { message: `${what} is not implemented yet` });
      return { ok: true };
    };
    ipcMain.handle(INVOKE.CAPTURE_REGION, notYet('Region snip'));
    ipcMain.handle(INVOKE.CAPTURE_FULLSCREEN, notYet('Full screenshot'));
    ipcMain.handle(INVOKE.WINDOW_TOGGLE_FULLSCREEN, () => {
      panel.setFullScreen(!panel.isFullScreen());
      return windowState();
    });
    ipcMain.handle(INVOKE.WINDOW_HIDE, () => {
      panel.hide();
      return windowState();
    });
    ipcMain.handle(INVOKE.WINDOW_GET_STATE, () => windowState());
    ipcMain.handle(INVOKE.CLIPBOARD_WRITE_TEXT, (_e, { text }) => {
      clipboard.writeText(String(text ?? ''));
      return { ok: true };
    });
  }

  function dispose() {
    globalShortcut.unregisterAll();
  }

  return { start, showPanel, sendToPanel, registerIpc, dispose };
}

module.exports = { createShell };
