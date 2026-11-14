'use strict';

/**
 * History store: chat sessions persisted as one JSON file per session in
 * dataDir/history/<id>.json, plus dataDir/history/index.json with summaries.
 * Images are stored inline as base64. Electron-free.
 *
 * All methods are synchronous and keep an in-memory copy; every change is
 * written to disk atomically before the method returns.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic, quarantine } = require('./fsutil');

const DEFAULT_TITLE = 'New chat';
const SCREENSHOT_TITLE = 'Screenshot';
const TITLE_MAX = 40;
const RENAME_MAX = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const newId = () => crypto.randomUUID();
const copy = (v) => JSON.parse(JSON.stringify(v));

/** Title from the first user message: first ~40 chars of text, or "Screenshot". */
function autoTitle(message) {
  const text = String((message && message.text) || '').replace(/\s+/g, ' ').trim();
  if (!text) return (message && message.images && message.images.length) ? SCREENSHOT_TITLE : DEFAULT_TITLE;
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function summaryOf(s) {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  };
}

/** Public Session shape (drops internal fields). */
function publicSession(s) {
  return copy({ ...summaryOf(s), messages: s.messages });
}

function isValidStoredSession(s) {
  return s && typeof s === 'object' && typeof s.id === 'string' && ID_RE.test(s.id)
    && typeof s.title === 'string' && Number.isFinite(s.createdAt) && Number.isFinite(s.updatedAt)
    && Array.isArray(s.messages);
}

/**
 * @param {{ dataDir: string, logger?: Pick<Console,'warn'>, now?: () => number }} opts
 */
function createHistoryStore({ dataDir, logger = console, now = Date.now }) {
  const dir = path.join(dataDir, 'history');
  const indexFile = path.join(dir, 'index.json');
  const sessionFile = (id) => path.join(dir, `${id}.json`);

  /** id -> stored session (with internal `titleLocked`). Loaded lazily from disk. */
  const cache = new Map();
  /** id -> SessionSummary */
  const summaries = new Map();
  const listeners = new Set();

  // A monotonic clock so ordering is stable even within the same millisecond.
  let lastTime = 0;
  const tick = () => {
    const t = Math.max(now(), lastTime + 1);
    lastTime = t;
    return t;
  };

  function emit() {
    for (const cb of [...listeners]) {
      try { cb(); } catch (err) { logger.warn(`[core] history listener failed: ${err.message}`); }
    }
  }

  function loadSessionFile(id) {
    const r = readJson(sessionFile(id));
    if (r.ok && isValidStoredSession(r.value) && r.value.id === id) return r.value;
    if (!r.missing) {
      logger.warn(`[core] history: session ${id} unreadable, skipping`);
      quarantine(sessionFile(id));
    }
    return null;
  }

  function rebuildIndex() {
    summaries.clear();
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn(`[core] history: cannot read ${dir}: ${err.message}`);
    }
    for (const f of files) {
      const id = f.slice(0, -'.json'.length);
      if (!ID_RE.test(id)) continue;
      const s = loadSessionFile(id);
      if (s) summaries.set(id, summaryOf(s));
    }
    writeIndex();
  }

  function writeIndex() {
    try {
      writeJsonAtomic(indexFile, { version: 1, sessions: [...summaries.values()] });
    } catch (err) {
      logger.warn(`[core] history: could not save index: ${err.message}`);
    }
  }

  // ---- startup ----
  const idx = readJson(indexFile);
  if (idx.ok && idx.value && Array.isArray(idx.value.sessions)) {
    for (const s of idx.value.sessions) {
      if (s && typeof s.id === 'string' && ID_RE.test(s.id) && fs.existsSync(sessionFile(s.id))) {
        summaries.set(s.id, {
          id: s.id,
          title: String(s.title || DEFAULT_TITLE),
          createdAt: Number(s.createdAt) || 0,
          updatedAt: Number(s.updatedAt) || 0,
          messageCount: Number(s.messageCount) || 0,
        });
      }
    }
  } else {
    if (!idx.missing) {
      logger.warn('[core] history index unreadable, rebuilding from session files');
      quarantine(indexFile);
    }
    rebuildIndex();
  }
  for (const s of summaries.values()) lastTime = Math.max(lastTime, s.updatedAt);

  function getStored(id) {
    if (typeof id !== 'string' || !ID_RE.test(id) || !summaries.has(id)) return null;
    if (cache.has(id)) return cache.get(id);
    const s = loadSessionFile(id);
    if (!s) {
      summaries.delete(id);
      writeIndex();
      return null;
    }
    cache.set(id, s);
    return s;
  }

  function save(s) {
    writeJsonAtomic(sessionFile(s.id), s);
    cache.set(s.id, s);
    summaries.set(s.id, summaryOf(s));
    writeIndex();
    emit();
  }

  function requireSession(id) {
    const s = getStored(id);
    if (!s) throw new Error(`Chat not found: ${id}`);
    return s;
  }

  return {
    /** @returns {import('../../shared/contracts').SessionSummary[]} newest first */
    listSessions() {
      return [...summaries.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
        .map((s) => ({ ...s }));
    },

    getSession(id) {
      const s = getStored(id);
      return s ? publicSession(s) : null;
    },

    createSession() {
      const t = tick();
      const s = { id: newId(), title: DEFAULT_TITLE, titleLocked: false, createdAt: t, updatedAt: t, messages: [] };
      save(s);
      return publicSession(s);
    },

    renameSession(id, title) {
      const s = requireSession(id);
      const clean = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().slice(0, RENAME_MAX);
      if (clean) {
        s.title = clean;
        s.titleLocked = true;
      } else {
        // Empty rename: go back to the automatic title.
        const firstUser = s.messages.find((m) => m.role === 'user');
        s.title = firstUser ? autoTitle(firstUser) : DEFAULT_TITLE;
        s.titleLocked = false;
      }
      save(s);
      return summaryOf(s);
    },

    deleteSession(id) {
      if (typeof id !== 'string' || !ID_RE.test(id)) return;
      const existed = summaries.delete(id);
      cache.delete(id);
      try {
        fs.unlinkSync(sessionFile(id));
      } catch (err) {
        if (err.code !== 'ENOENT') logger.warn(`[core] history: could not delete ${id}: ${err.message}`);
      }
      if (existed) {
        writeIndex();
        emit();
      }
    },

    /**
     * Append a message. Fills in `id` and `createdAt` if missing. The first user
     * message sets the session title unless the user renamed it.
     */
    appendMessage(id, message) {
      const s = requireSession(id);
      const t = tick();
      const m = { ...copy(message), id: (message && message.id) || newId(), createdAt: (message && message.createdAt) || t };
      if (m.role === 'user' && !s.titleLocked && !s.messages.some((x) => x.role === 'user')) {
        s.title = autoTitle(m);
      }
      s.messages.push(m);
      s.updatedAt = t;
      save(s);
      return copy(m);
    },

    /** Remove one message (used by retry to drop a failed reply). Returns true if it was there. */
    removeMessage(id, messageId) {
      const s = requireSession(id);
      const i = s.messages.findIndex((m) => m.id === messageId);
      if (i < 0) return false;
      s.messages.splice(i, 1);
      s.updatedAt = tick();
      save(s);
      return true;
    },

    /** Internal: subscribe to any change in the session list. Returns unsubscribe. */
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

module.exports = { createHistoryStore, autoTitle, DEFAULT_TITLE };
