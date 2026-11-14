// OWNER: Worker 3. Chat state for the panel: which session is open, its messages,
// and sends that are still waiting for the model. No DOM. The window.proxy API is
// passed in, so tests can use a fake.

/**
 * Can the composer send right now?
 * @param {{ text?: string, images?: unknown[] }} draft
 */
export function canSend(draft) {
  const text = String((draft && draft.text) || '').trim();
  const images = (draft && draft.images) || [];
  return text.length > 0 || images.length > 0;
}

/**
 * @param {{
 *   api: { chat: { send(req: object): Promise<any> }, history: { get(id: string): Promise<any> } },
 *   onChange?: () => void,
 *   now?: () => number,
 * }} opts
 */
export function createConversation({ api, onChange = () => {}, now = () => Date.now() }) {
  /** Conversations seen this run, by session id. A new chat has id null until its first send returns. */
  const byId = new Map();
  let current = blank();
  let openToken = 0;
  let localSeq = 0;
  // Sends go one at a time so follow-ups in a brand-new chat land in the session
  // the first send created, and the model sees replies in order.
  let queue = Promise.resolve();

  function blank(id = null) {
    return { id, messages: [], pending: [], loading: false };
  }

  function localId() {
    localSeq += 1;
    return `local-${localSeq}`;
  }

  return {
    /** Session id of the open chat, or null for an unsaved new chat. */
    get sessionId() {
      return current.id;
    },

    get loading() {
      return current.loading;
    },

    /** True while any send for the open chat is waiting on the model. */
    get busy() {
      return current.pending.length > 0;
    },

    /**
     * Messages to render for the open chat: saved ones, then pending sends as a
     * user bubble plus a placeholder assistant bubble ({ pending: true }).
     */
    visibleMessages() {
      const out = [...current.messages];
      for (const p of current.pending) {
        if (p.user) out.push(p.user);
        out.push({ id: `${p.id || p.user.id}-reply`, role: 'assistant', pending: true, createdAt: p.createdAt || p.user.createdAt });
      }
      return out;
    },

    /** Start an empty chat. The session is created when the first message is sent. */
    newChat() {
      openToken += 1;
      current = blank();
      onChange();
    },

    /** Open a saved session and load its messages. */
    async open(id) {
      if (!id) return this.newChat();
      const token = ++openToken;
      const known = byId.get(id);
      current = known || blank(id);
      byId.set(id, current);
      if (current.pending.length) {
        onChange(); // keep local state; reloading would drop the pending bubbles
        return;
      }
      const convo = current;
      convo.loading = true;
      onChange();
      try {
        const session = await api.history.get(id);
        if (token !== openToken) return;
        if (!session) {
          byId.delete(id);
          current = blank();
        } else {
          convo.messages = Array.isArray(session.messages) ? session.messages : [];
        }
      } finally {
        convo.loading = false;
        if (token === openToken) onChange();
      }
    },

    /**
     * Send a message in the open chat. Resolves when the reply has arrived (or failed).
     * Never rejects: a failed call shows as an error bubble.
     * @param {{ text?: string, images?: object[] }} draft
     */
    send(draft) {
      if (!canSend(draft)) return Promise.resolve(null);
      const convo = current;
      const text = String(draft.text || '').trim();
      const images = [...(draft.images || [])];
      const user = { id: localId(), role: 'user', createdAt: now(), text, images };
      const entry = { user };
      convo.pending.push(entry);
      onChange();

      const job = queue.then(async () => {
        let result = null;
        try {
          result = await api.chat.send({ sessionId: convo.id, text, images });
          if (!result || !result.userMessage || !result.assistantMessage) {
            throw new Error('The app returned an empty reply.');
          }
          if (!convo.id) {
            convo.id = result.sessionId;
            byId.set(convo.id, convo);
          }
          convo.messages.push(result.userMessage, result.assistantMessage);
        } catch (err) {
          const message = (err && err.message) || String(err);
          convo.messages.push(user, {
            id: localId(),
            role: 'assistant',
            createdAt: now(),
            error: `Couldn't send: ${message}`,
            local: true, // never reached the app's history, so it can't be retried
          });
        } finally {
          convo.pending.splice(convo.pending.indexOf(entry), 1);
          onChange();
        }
        return result;
      });
      queue = job.catch(() => {});
      return job;
    },

    /** True when the open chat ends in a failed reply that the app can ask the model for again. */
    canRetry() {
      const last = current.messages[current.messages.length - 1];
      return !!current.id && !current.pending.length && !!last && last.role === 'assistant' && !!last.error && !last.local;
    },

    /**
     * Ask the model again for the last message of the open chat, replacing the
     * failed reply. Never rejects.
     */
    retry() {
      if (!this.canRetry()) return Promise.resolve(null);
      const convo = current;
      const failed = convo.messages.pop();
      const entry = { id: localId(), createdAt: now() };
      convo.pending.push(entry);
      onChange();

      const job = queue.then(async () => {
        let result = null;
        try {
          result = await api.chat.send({ sessionId: convo.id, retry: true, text: '', images: [] });
          if (!result || !result.assistantMessage) throw new Error('The app returned an empty reply.');
          convo.messages.push(result.assistantMessage);
        } catch (err) {
          const message = (err && err.message) || String(err);
          convo.messages.push({ ...failed, error: `${failed.error}\n\nRetry failed: ${message}` });
        } finally {
          convo.pending.splice(convo.pending.indexOf(entry), 1);
          onChange();
        }
        return result;
      });
      queue = job.catch(() => {});
      return job;
    },

    /** Call after a session was deleted, so the open chat resets if it was that one. */
    forget(id) {
      const convo = byId.get(id);
      byId.delete(id);
      if (convo && convo === current) {
        current = blank();
        onChange();
      }
    },
  };
}
