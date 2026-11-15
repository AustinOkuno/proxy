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
  CLAUDE_MODELS,
  PANEL_DOCKS,
  FONT_LEVELS,
  ASSET_KINDS,
  SETTINGS_LIMITS,
  DEFAULT_SETTINGS,
} = require('../shared/contracts');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);
const ALLOWED_EVENTS = new Set(Object.values(EVENTS));

const api = {
  chat: {
    /** @param {import('../shared/contracts').ChatSendRequest} req */
    send: invoke(INVOKE.CHAT_SEND),
    /**
     * Stop a send that is still waiting on the model. Pass the requestId given to
     * send(), or { sessionId } to stop every request in that chat.
     * @param {string | { requestId?: string, sessionId?: string }} target
     */
    cancel: (target) => ipcRenderer.invoke(
      INVOKE.CHAT_CANCEL,
      typeof target === 'string' ? { requestId: target } : { ...(target || {}) },
    ),
  },
  history: {
    list: invoke(INVOKE.HISTORY_LIST),
    get: (id) => ipcRenderer.invoke(INVOKE.HISTORY_GET, { id }),
    create: invoke(INVOKE.HISTORY_CREATE),
    rename: (id, title) => ipcRenderer.invoke(INVOKE.HISTORY_RENAME, { id, title }),
    delete: (id) => ipcRenderer.invoke(INVOKE.HISTORY_DELETE, { id }),
    /** folderId null = move back to the top level. */
    move: (id, folderId) => ipcRenderer.invoke(INVOKE.HISTORY_MOVE, { id, folderId: folderId || null }),
    setPinned: (id, pinned) => ipcRenderer.invoke(INVOKE.HISTORY_SET_PINNED, { id, pinned: !!pinned }),
    /** @param {string} query @param {{ limit?: number }} [opts] */
    search: (query, opts) => ipcRenderer.invoke(INVOKE.HISTORY_SEARCH, { ...(opts || {}), query: String(query || '') }),
  },
  folders: {
    list: invoke(INVOKE.FOLDER_LIST),
    create: (name) => ipcRenderer.invoke(INVOKE.FOLDER_CREATE, { name }),
    /** @param {{ name?: string, collapsed?: boolean, pinned?: boolean }} patch */
    update: (id, patch) => ipcRenderer.invoke(INVOKE.FOLDER_UPDATE, { ...(patch || {}), id }),
    delete: (id) => ipcRenderer.invoke(INVOKE.FOLDER_DELETE, { id }),
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
    /** @param {string} dock  a PANEL_DOCKS value */
    dock: (dock) => ipcRenderer.invoke(INVOKE.WINDOW_DOCK, { dock }),
  },
  assets: {
    /** Opens a file dialog. @param {'image'|'font'} kind */
    import: (kind) => ipcRenderer.invoke(INVOKE.ASSETS_IMPORT, { kind }),
    get: (id) => ipcRenderer.invoke(INVOKE.ASSETS_GET, { id }),
    list: (kind) => ipcRenderer.invoke(INVOKE.ASSETS_LIST, kind ? { kind } : {}),
    delete: (id) => ipcRenderer.invoke(INVOKE.ASSETS_DELETE, { id }),
  },
  usage: {
    get: invoke(INVOKE.USAGE_GET),
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
    CLAUDE_MODELS,
    PANEL_DOCKS,
    FONT_LEVELS,
    ASSET_KINDS,
    SETTINGS_LIMITS,
    DEFAULT_SETTINGS,
  },
};

contextBridge.exposeInMainWorld('proxy', api);
