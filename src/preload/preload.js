'use strict';

/**
 * Panel preload. OWNER: lead.
 *
 * Exposes `window.proxy` to the renderer. This is the ONLY way the renderer
 * talks to the main process. Shapes are documented in src/shared/contracts.js
 * and SPEC.md. Workers request changes here via the interface-change process
 * in CLAUDE.md.
 *
 * Runs with contextIsolation: true, nodeIntegration: false, sandbox: false
 * (sandbox is off only so this file can require ../shared/contracts).
 */

const { contextBridge, ipcRenderer } = require('electron');
const {
  INVOKE,
  EVENTS,
  SEND_MODES,
  PANEL_VISIBILITY,
  ANSWER_STYLES,
  PROVIDERS,
  DEFAULT_SETTINGS,
} = require('../shared/contracts');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);
const ALLOWED_EVENTS = new Set(Object.values(EVENTS));

const api = {
  chat: {
    /** @param {import('../shared/contracts').ChatSendRequest} req */
    send: invoke(INVOKE.CHAT_SEND),
  },
  history: {
    list: invoke(INVOKE.HISTORY_LIST),
    get: (id) => ipcRenderer.invoke(INVOKE.HISTORY_GET, { id }),
    create: invoke(INVOKE.HISTORY_CREATE),
    rename: (id, title) => ipcRenderer.invoke(INVOKE.HISTORY_RENAME, { id, title }),
    delete: (id) => ipcRenderer.invoke(INVOKE.HISTORY_DELETE, { id }),
  },
  settings: {
    get: invoke(INVOKE.SETTINGS_GET),
    /** @param {import('../shared/contracts').SettingsPatch} patch */
    update: invoke(INVOKE.SETTINGS_UPDATE),
  },
  capture: {
    region: invoke(INVOKE.CAPTURE_REGION),
    fullscreen: invoke(INVOKE.CAPTURE_FULLSCREEN),
  },
  window: {
    toggleFullscreen: invoke(INVOKE.WINDOW_TOGGLE_FULLSCREEN),
    hide: invoke(INVOKE.WINDOW_HIDE),
    getState: invoke(INVOKE.WINDOW_GET_STATE),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(INVOKE.CLIPBOARD_WRITE_TEXT, { text }),
  },
  /**
   * Subscribe to a main -> renderer event (a value of EVENTS).
   * @returns {() => void} unsubscribe
   */
  on(eventName, callback) {
    if (!ALLOWED_EVENTS.has(eventName)) {
      throw new Error(`proxy.on: unknown event "${eventName}"`);
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(eventName, listener);
    return () => ipcRenderer.removeListener(eventName, listener);
  },
  constants: {
    EVENTS,
    SEND_MODES,
    PANEL_VISIBILITY,
    ANSWER_STYLES,
    PROVIDERS,
    DEFAULT_SETTINGS,
  },
};

contextBridge.exposeInMainWorld('proxy', api);
