'use strict';

/**
 * chat.send: store the user message, call the provider with the whole session,
 * store the assistant reply (or an error reply). Electron-free.
 */

const MAX_IMAGES = 10;
const MAX_TEXT = 100_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg'];

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
  /** @param {import('../../shared/contracts').ChatSendRequest} req */
  async function send(req = {}) {
    if (req && req.retry === true) return retry(req.sessionId);
    const text = typeof req.text === 'string' ? req.text.slice(0, MAX_TEXT) : '';
    const images = cleanImages(req.images);
    if (!text.trim() && !images.length) throw new Error('Type a message or attach a screenshot first.');

    let sessionId = typeof req.sessionId === 'string' ? req.sessionId : null;
    if (!sessionId || !history.getSession(sessionId)) sessionId = history.createSession().id;

    const userMessage = history.appendMessage(sessionId, { role: 'user', text, images });
    return reply(sessionId, userMessage);
  }

  /**
   * Ask the model again for the session's last user message. A failed reply
   * after it is removed first, so the chat doesn't keep the old error.
   */
  async function retry(sessionId) {
    const session = typeof sessionId === 'string' ? history.getSession(sessionId) : null;
    if (!session) throw new Error('That chat no longer exists.');
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === 'assistant') {
      if (!last.error) throw new Error('The last reply did not fail, so there is nothing to retry.');
      history.removeMessage(sessionId, last.id);
    }
    const msgs = history.getSession(sessionId).messages;
    const userMessage = msgs[msgs.length - 1];
    if (!userMessage || userMessage.role !== 'user') throw new Error('There is no message to retry.');
    return reply(sessionId, userMessage);
  }

  async function reply(sessionId, userMessage) {
    const { answerStyle, provider: providerName } = settings.get();

    let out;
    try {
      const provider = getProvider(providerName);
      const session = history.getSession(sessionId);
      const result = await provider.generate({ messages: session ? session.messages : [userMessage], answerStyle });
      out = { answer: String(result.answer || ''), explanation: String(result.explanation || '') };
    } catch (err) {
      const message = (err && err.message) || 'The model call failed.';
      logger.warn(`[core] chat.send failed: ${message}`);
      out = { error: message };
    }

    // The session may have been deleted while we waited for the model.
    if (!history.getSession(sessionId)) {
      const t = Date.now();
      return { sessionId, userMessage, assistantMessage: { id: `orphan-${t}`, role: 'assistant', createdAt: t, answerStyle, ...out } };
    }
    const assistantMessage = history.appendMessage(sessionId, { role: 'assistant', answerStyle, ...out });
    return { sessionId, userMessage, assistantMessage };
  }

  return { send };
}

module.exports = { createChat, cleanImages };
