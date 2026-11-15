'use strict';

/**
 * Shell: global hotkeys, screen capture (region snip + full screen), panel and
 * overlay window management. OWNER: Worker 1.
 *
 * Exported shape matches SPEC.md section 4.3.
 */

const path = require('node:path');
const { globalShortcut, clipboard, dialog, nativeImage } = require('electron');
const { INVOKE, EVENTS } = require('../../shared/contracts');
const { createPanel } = require('./panel');
const { createHotkeyManager, withFallbacks } = require('./hotkeys');
const { displayUnderCursor, grabDisplay, cropToSelection, toImageData } = require('./capture');
const { openOverlay } = require('./overlay/overlay');
const visibility = require('./visibility');
const { createAssetStore, dialogFilters, fitWithin } = require('./assets');

// Time for the compositor to actually remove the hidden panel from the screen
// before we grab it.
const HIDE_SETTLE_MS = 250;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scale an image down with Electron's decoder so neither side is over maxSide.
 * Returns null (keep the original) when it already fits or can't be decoded.
 */
function scaleImage(buf, mimeType, maxSide) {
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return null;
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error("That image couldn't be opened. Is the file damaged?");
  const { width, height } = img.getSize();
  const size = fitWithin(width, height, maxSide);
  if (!size) return null;
  const small = img.resize({ ...size, quality: 'best' });
  return mimeType === 'image/jpeg'
    ? { data: small.toJPEG(90), mimeType }
    : { data: small.toPNG(), mimeType };
}

/**
 * @param {{
 *   settings: { get(): object, update(patch: object): object, onChange(cb: Function): Function },
 *   dataDir: string,
 *   preloadPath: string,
 *   rendererHtmlPath: string,
 * }} opts
 */
async function createShell({ settings, dataDir, preloadPath, rendererHtmlPath }) {
  const assets = createAssetStore({ dir: path.join(dataDir, 'assets'), scaleImage });

  const panel = createPanel({
    settings,
    preloadPath,
    rendererHtmlPath,
    onStateChange: (state) => panel.send(EVENTS.WINDOW_STATE, state),
  });

  let capturing = false;
  let activeOverlay = null;
  let unsubscribe = null;
  let mode = settings.get().panelVisibility;

  function sendToPanel(channel, payload) {
    panel.send(channel, payload);
  }

  function showPanel() {
    panel.show();
  }

  function reportError(message) {
    console.warn(`[shell] ${message}`);
    sendToPanel(EVENTS.CAPTURE_ERROR, { message });
  }

  /**
   * Shared capture flow. `kind` is 'region' | 'fullscreen'.
   * Hides the panel, grabs the display under the cursor, (for region) lets the
   * user select, then shows the panel and sends CAPTURE_READY.
   */
  async function capture(kind) {
    if (capturing) return;
    capturing = true;
    const wasVisible = panel.isVisible();
    try {
      const display = displayUnderCursor();
      if (wasVisible) {
        panel.hide();
        await delay(HIDE_SETTLE_MS);
      }
      let image = await grabDisplay(display);

      if (kind === 'region') {
        activeOverlay = openOverlay(display, image);
        const rect = await activeOverlay.result;
        activeOverlay = null;
        if (!rect) {
          if (wasVisible) panel.show();
          sendToPanel(EVENTS.CAPTURE_CANCELLED);
          return;
        }
        image = cropToSelection(image, display, rect);
        if (!image) {
          if (wasVisible) panel.show();
          sendToPanel(EVENTS.CAPTURE_CANCELLED);
          return;
        }
      }

      const result = { kind, image: toImageData(image), capturedAt: Date.now() };
      panel.show();
      sendToPanel(EVENTS.CAPTURE_READY, result);
    } catch (err) {
      panel.show();
      reportError(`Screen capture failed: ${err.message}`);
    } finally {
      activeOverlay = null;
      capturing = false;
    }
  }

  function togglePanel() {
    if (visibility.toggleAction(mode, panel.isVisible()) === 'hide') panel.hide();
    else panel.show();
  }

  /**
   * Ctrl+Alt+Space (SPEC 9.6): bring keyboard focus to the panel, showing it if
   * needed; pressed again while the panel has focus, give focus back.
   */
  function focusPanel() {
    if (capturing) return;
    if (panel.isVisible() && panel.isFocused()) panel.blur();
    else panel.focus();
  }

  const hotkeys = createHotkeyManager({
    globalShortcut,
    handlers: {
      regionSnip: () => capture('region'),
      fullScreenshot: () => capture('fullscreen'),
      togglePanel,
      focusPanel,
    },
    onError: (message) => sendToPanel(EVENTS.CAPTURE_ERROR, { message }),
  });

  async function start() {
    await panel.create();
    const s = settings.get();
    mode = s.panelVisibility;
    if (visibility.showAtStart(mode)) panel.show();

    // Register after the panel has loaded so failures reach the chat as errors.
    hotkeys.apply(withFallbacks(s.hotkeys));

    unsubscribe = settings.onChange((next) => {
      hotkeys.apply(withFallbacks(next.hotkeys));
      panel.applySettings(next);
      if (visibility.onModeChange(mode, next.panelVisibility) === 'show') panel.show();
      mode = next.panelVisibility;
    });
  }

  function registerIpc(ipcMain) {
    ipcMain.handle(INVOKE.CAPTURE_REGION, () => {
      capture('region');
      return { ok: true };
    });
    ipcMain.handle(INVOKE.CAPTURE_FULLSCREEN, () => {
      capture('fullscreen');
      return { ok: true };
    });
    ipcMain.handle(INVOKE.WINDOW_TOGGLE_FULLSCREEN, () => panel.toggleFullscreen());
    ipcMain.handle(INVOKE.WINDOW_HIDE, () => {
      panel.hide();
      return panel.state();
    });
    ipcMain.handle(INVOKE.WINDOW_GET_STATE, () => panel.state());
    ipcMain.handle(INVOKE.WINDOW_DOCK, (_e, arg) => panel.dock(arg && arg.dock));
    ipcMain.handle(INVOKE.CLIPBOARD_WRITE_TEXT, (_e, arg) => {
      clipboard.writeText(String((arg && arg.text) ?? ''));
      return { ok: true };
    });

    // Assets (SPEC 9.5.5). Errors thrown here reach the renderer as readable messages.
    ipcMain.handle(INVOKE.ASSETS_IMPORT, (_e, arg) => importAsset(arg && arg.kind));
    ipcMain.handle(INVOKE.ASSETS_GET, (_e, arg) => assets.get(arg && arg.id));
    ipcMain.handle(INVOKE.ASSETS_LIST, (_e, arg) => assets.list(arg && arg.kind));
    ipcMain.handle(INVOKE.ASSETS_DELETE, (_e, arg) => assets.delete(arg && arg.id));
  }

  let importing = false;

  /** Open a file dialog over the panel and copy the chosen file in. null = cancelled. */
  async function importAsset(kind) {
    if (kind !== 'image' && kind !== 'font') throw new Error(`Unknown asset kind "${kind}".`);
    if (importing) return null;
    importing = true;
    try {
      const options = {
        title: kind === 'image' ? 'Choose a background image' : 'Choose a font file',
        properties: ['openFile'],
        filters: dialogFilters(kind),
      };
      const parent = panel.window;
      const res = parent && !parent.isDestroyed()
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
      return assets.importFile(kind, res.filePaths[0]);
    } finally {
      importing = false;
    }
  }

  function dispose() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    hotkeys.dispose();
    globalShortcut.unregisterAll();
    if (activeOverlay) activeOverlay.close();
    panel.dispose();
  }

  return { start, showPanel, sendToPanel, registerIpc, dispose };
}

module.exports = { createShell };
