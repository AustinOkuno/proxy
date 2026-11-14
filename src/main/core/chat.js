'use strict';

/**
 * chat.send: store the user message, call the provider with the whole session,
 * store the assistant reply (or an error reply). chat.cancel stops a request
 * that is still waiting on the model. Electron-free.
 */

const MAX_IMAGES = 10;
const MAX_TEXT = 100_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg'];
// Cancels can arrive for a request id the main process hasn't seen yet; remember
// a few so that request is stopped as soon as it starts.
const MAX_EARLY_CANCELS = 50;

function cleanImages(images) {
  if (!Array.isArray(images)) return [];
  const out = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    if (!img || typeof img.dataBase64 !== 'string' || !img.dataBase64) continue;
    const clean = {
      mimeType: IMAGE_TYPES.includes(img.mimeType) ? img.mimeType : 'image/png',
      dataBase64: img.dataBase64.replace(/^data:[^,]*,/, ''),
    };
    if (Number.isFinite(img.width)) clean.width = img.width;
    if (Number.isFinite(img.height)) clean.height = img.height;
    out.push(clean);
  }
  return out;
}

/**
 * @param {{
 *   history: ReturnType<typeof import('./history').createHistoryStore>,
 *   settings: { get(): import('../../shared/contracts').Settings },
 *   getProvider: (name: string) => { generate(args: any): Promise<{answer: string, explanation: string}> },
 *   logger?: Pick<Console,'warn'>,
 * }} deps
 */
function createChat({ history, settings, getProvider, logger = console }) {
  /** Requests waiting on the model: requestId -> { controller, sessionId }. */
  const inflight = new Map();
  const earlyCancels = new Set();
  let seq = 0;

  const requestIdOf = (req) => (req && typeof req.requestId === 'string' && req.requestId
    ? req.requestId
    : `req-${Date.now()}-${++seq}`);

  /** @param {import('../../shared/contracts').ChatSendRequest} req */
  async function send(req = {}) {
    req = req || {};
    const requestId = requestIdOf(req);
    if (req.retry === true) return retry(req.sessionId, requestId);
    const text = typeof req.text === 'string' ? req.text.slice(0, MAX_TEXT) : '';
    const images = cleanImages(req.images);
    if (!text.trim() && !images.length) throw new Error('Type a message or attach a screenshot first.');

    let sessionId = typeof req.sessionId === 'string' ? req.sessionId : null;
    if (!sessionId || !history.getSession(sessionId)) sessionId = history.createSession().id;

    const userMessage = history.appendMessage(sessionId, { role: 'user', text, images });
    return reply(sessionId, userMessage, requestId);
  }

  /**
   * Stop requests that are still waiting on the model: the one with `requestId`,
   * or every one in `sessionId`. The stopped send resolves with an assistant
   * message that has `stopped: true`.
   * @param {{ requestId?: string, sessionId?: string }} arg
   * @returns {{ ok: true, cancelled: number }}
   */
  function cancel(arg = {}) {
    const { requestId, sessionId } = arg || {};
    let cancelled = 0;
    for (const [id, entry] of inflight) {
      if ((requestId && id === requestId) || (sessionId && entry.sessionId === sessionId)) {
        entry.controller.abort();
        cancelled += 1;
      }
    }
    if (!cancelled && typeof requestId === 'string' && requestId) {
      earlyCancels.add(requestId);
      if (earlyCancels.size > MAX_EARLY_CANCELS) earlyCancels.delete(earlyCancels.values().next().value);
    }
    return { ok: true, cancelled };
  }

  /**
   * Ask the model again for the session's last user message. A failed or
   * stopped reply after it is removed first, so the chat doesn't keep it.
   */
  async function retry(sessionId, requestId) {
    const session = typeof sessionId === 'string' ? history.getSession(sessionId) : null;
    if (!session) throw new Error('That chat no longer exists.');
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === 'assistant') {
      if (!last.error && !last.stopped) throw new Error('The last reply did not fail, so there is nothing to retry.');
      history.removeMessage(sessionId, last.id);
    }
    const msgs = history.getSession(sessionId).messages;
    const userMessage = msgs[msgs.length - 1];
    if (!userMessage || userMessage.role !== 'user') throw new Error('There is no message to retry.');
    return reply(sessionId, userMessage, requestId);
  }

  async function reply(sessionId, userMessage, requestId) {
    const { answerStyle, provider: providerName } = settings.get();
    const controller = new AbortController();
    inflight.set(requestId, { controller, sessionId });
    if (earlyCancels.delete(requestId)) controller.abort();

    let out;
    try {
      if (controller.signal.aborted) throw new Error('Stopped.');
      const provider = getProvider(providerName);
      const session = history.getSession(sessionId);
      const result = await provider.generate({
        messages: session ? session.messages : [userMessage],
        answerStyle,
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error('Stopped.');
      out = { answer: String(result.answer || ''), explanation: String(result.explanation || '') };
      if (typeof result.model === 'string' && result.model) out.model = result.model;
    } catch (err) {
      if (controller.signal.aborted) {
        out = { stopped: true };
      } else {
        const message = (err && err.message) || 'The model call failed.';
        logger.warn(`[core] chat.send failed: ${message}`);
        out = { error: message };
      }
    } finally {
      inflight.delete(requestId);
    }

    // The session may have been deleted while we waited for the model.
    if (!history.getSession(sessionId)) {
      const t = Date.now();
      return { sessionId, userMessage, assistantMessage: { id: `orphan-${t}`, role: 'assistant', createdAt: t, answerStyle, ...out } };
    }
    const assistantMessage = history.appendMessage(sessionId, { role: 'assistant', answerStyle, ...out });
    return { sessionId, userMessage, assistantMessage };
  }

  return { send, cancel };
}

module.exports = { createChat, cleanImages };
