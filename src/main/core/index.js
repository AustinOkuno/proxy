'use strict';

/**
 * Core: settings store, history/session storage, LLM provider. OWNER: Worker 2.
 *
 * Exported shape matches SPEC.md section 4.1. Internals live in:
 *   settings.js  validated settings persisted to dataDir/settings.json
 *   history.js   sessions in dataDir/history/<id>.json + index.json
 *   chat.js      chat.send (user message -> provider -> assistant message)
 *   llm/         provider adapters (Gemini)
 */

const { INVOKE, EVENTS } = require('../../shared/contracts');
const { createSettingsStore } = require('./settings');
const { createHistoryStore } = require('./history');
const { createChat } = require('./chat');
const { createProvider } = require('./llm');

/**
 * @param {{ dataDir: string, env: NodeJS.ProcessEnv, logger?: Pick<Console,'warn'>, providerFactory?: typeof createProvider }} opts
 */
async function createCore({ dataDir, env = {}, logger = console, providerFactory = createProvider }) {
  if (!dataDir) throw new Error('createCore: dataDir is required');

  const settings = createSettingsStore({ dataDir, logger });
  const historyStore = createHistoryStore({ dataDir, logger });

  const providers = new Map();
  const getProvider = (name) => {
    if (!providers.has(name)) providers.set(name, providerFactory(name, { env }));
    return providers.get(name);
  };

  const chat = createChat({ history: historyStore, settings, getProvider, logger });

  const history = {
    listSessions: historyStore.listSessions,
    getSession: historyStore.getSession,
    createSession: historyStore.createSession,
    renameSession: historyStore.renameSession,
    deleteSession: historyStore.deleteSession,
    appendMessage: historyStore.appendMessage,
  };

  const idOf = (arg) => (arg && typeof arg === 'object' ? arg.id : arg);

  function registerIpc(ipcMain, { sendToPanel }) {
    const send = (channel, payload) => {
      try { sendToPanel(channel, payload); } catch (err) { logger.warn(`[core] sendToPanel failed: ${err.message}`); }
    };

    ipcMain.handle(INVOKE.CHAT_SEND, (_e, req) => chat.send(req));
    ipcMain.handle(INVOKE.HISTORY_LIST, () => history.listSessions());
    ipcMain.handle(INVOKE.HISTORY_GET, (_e, arg) => history.getSession(idOf(arg)));
    ipcMain.handle(INVOKE.HISTORY_CREATE, () => history.createSession());
    ipcMain.handle(INVOKE.HISTORY_RENAME, (_e, arg) => history.renameSession(idOf(arg), arg && arg.title));
    ipcMain.handle(INVOKE.HISTORY_DELETE, (_e, arg) => {
      history.deleteSession(idOf(arg));
      return { ok: true };
    });
    ipcMain.handle(INVOKE.SETTINGS_GET, () => settings.get());
    ipcMain.handle(INVOKE.SETTINGS_UPDATE, (_e, patch) => settings.update(patch));

    settings.onChange((s) => send(EVENTS.SETTINGS_CHANGED, s));
    historyStore.onChange(() => send(EVENTS.HISTORY_CHANGED));
  }

  return {
    settings: { get: settings.get, update: settings.update, onChange: settings.onChange },
    history,
    chat: { send: chat.send },
    registerIpc,
  };
}

module.exports = { createCore };
