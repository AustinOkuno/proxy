'use strict';

/**
 * Core: settings store, history/session storage, LLM provider. OWNER: Worker 2.
 *
 * STUB from the scaffold: in-memory settings and history, and a placeholder
 * reply instead of a model call. Worker 2 replaces the internals; the exported
 * shape must keep matching SPEC.md section "Main-process module interfaces".
 */

const { INVOKE, EVENTS, defaultSettings } = require('../../shared/contracts');

/**
 * @param {{ dataDir: string, env: NodeJS.ProcessEnv }} opts
 */
async function createCore({ dataDir, env }) { // eslint-disable-line no-unused-vars
  let current = defaultSettings();
  const listeners = new Set();

  const settings = {
    get: () => JSON.parse(JSON.stringify(current)),
    update(patch = {}) {
      current = {
        ...current,
        ...patch,
        hotkeys: { ...current.hotkeys, ...(patch.hotkeys || {}) },
      };
      const snapshot = settings.get();
      for (const cb of listeners) cb(snapshot);
      return snapshot;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  const sessions = new Map();
  let nextId = 1;
  const newId = () => String(nextId++);
  const summary = (s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  });

  const history = {
    listSessions: () => [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summary),
    getSession: (id) => sessions.get(id) || null,
    createSession() {
      const now = Date.now();
      const s = { id: newId(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
      sessions.set(s.id, s);
      return s;
    },
    renameSession(id, title) {
      const s = sessions.get(id);
      s.title = title;
      return summary(s);
    },
    deleteSession(id) {
      sessions.delete(id);
    },
    appendMessage(id, message) {
      const s = sessions.get(id);
      s.messages.push(message);
      s.updatedAt = Date.now();
      return message;
    },
  };

  async function sendChat({ sessionId, text = '', images = [] }) {
    const session = sessionId ? history.getSession(sessionId) : history.createSession();
    const userMessage = history.appendMessage(session.id, {
      id: newId(), role: 'user', createdAt: Date.now(), text, images,
    });
    const assistantMessage = history.appendMessage(session.id, {
      id: newId(),
      role: 'assistant',
      createdAt: Date.now(),
      answer: '(stub) Gemini is not wired up yet.',
      explanation: '(stub) Worker 2 replaces this with a real model call.',
      answerStyle: settings.get().answerStyle,
    });
    return { sessionId: session.id, userMessage, assistantMessage };
  }

  function registerIpc(ipcMain, { sendToPanel }) {
    ipcMain.handle(INVOKE.CHAT_SEND, async (_e, req) => {
      const result = await sendChat(req);
      sendToPanel(EVENTS.HISTORY_CHANGED);
      return result;
    });
    ipcMain.handle(INVOKE.HISTORY_LIST, () => history.listSessions());
    ipcMain.handle(INVOKE.HISTORY_GET, (_e, { id }) => history.getSession(id));
    ipcMain.handle(INVOKE.HISTORY_CREATE, () => {
      const s = history.createSession();
      sendToPanel(EVENTS.HISTORY_CHANGED);
      return s;
    });
    ipcMain.handle(INVOKE.HISTORY_RENAME, (_e, { id, title }) => {
      const s = history.renameSession(id, title);
      sendToPanel(EVENTS.HISTORY_CHANGED);
      return s;
    });
    ipcMain.handle(INVOKE.HISTORY_DELETE, (_e, { id }) => {
      history.deleteSession(id);
      sendToPanel(EVENTS.HISTORY_CHANGED);
      return { ok: true };
    });
    ipcMain.handle(INVOKE.SETTINGS_GET, () => settings.get());
    ipcMain.handle(INVOKE.SETTINGS_UPDATE, (_e, patch) => settings.update(patch));
    settings.onChange((s) => sendToPanel(EVENTS.SETTINGS_CHANGED, s));
  }

  return { settings, history, chat: { send: sendChat }, registerIpc };
}

module.exports = { createCore };
