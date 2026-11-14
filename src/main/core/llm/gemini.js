'use strict';

/**
 * Gemini adapter (free API key from .env). Implements the provider interface
 * from SPEC.md 4.2: generate({ messages, answerStyle }) -> { answer, explanation }.
 */

const { systemInstruction, buildContents, parseReply, applyStyle } = require('./prompt');

// Google limits the 2.5 models to keys that already used them, so new free keys
// get "model not found" for gemini-2.5-flash. Default to a current Flash model and,
// if the configured model is unavailable to this key, try the fallbacks in order.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-latest'];
const TIMEOUT_MS = 90_000;
const MISSING_KEY_MESSAGE = 'Gemini API key missing. Add GEMINI_API_KEY to .env and restart.';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    explanation: { type: 'STRING' },
  },
  required: ['answer', 'explanation'],
  propertyOrdering: ['answer', 'explanation'],
};

function defaultClientFactory(apiKey) {
  const { GoogleGenAI } = require('@google/genai');
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
}

function errStatus(err) {
  return Number(err && (err.status || err.code));
}

/** 429 with a zero limit means the key's tier has no access to this model at all (not a rate limit). */
function isNoFreeQuota(err) {
  return errStatus(err) === 429 && /limit:\s*0\b/i.test(String((err && err.message) || ''));
}

/** Errors that mean "this model isn't available to this key", so another model may work. */
function isModelUnavailable(err) {
  return errStatus(err) === 404 || isNoFreeQuota(err);
}

/** Turn an SDK / network error into a short, user-readable message (never containing the key). */
function friendlyError(err, apiKey) {
  const status = errStatus(err);
  const msg = String((err && err.message) || err || '');
  let out;
  if (status === 400 && /api[ _]?key/i.test(msg)) out = 'Gemini rejected the API key. Check GEMINI_API_KEY in .env and restart.';
  else if (status === 401 || status === 403) out = 'Gemini refused the request (permission denied). Check GEMINI_API_KEY in .env.';
  else if (status === 429 && isNoFreeQuota(err)) out = `Your Gemini key has no quota for this model. Set GEMINI_MODEL=${FALLBACK_MODELS[0]} in .env and restart.`;
  else if (status === 429) out = 'Gemini quota or rate limit reached. Wait a bit and try again.';
  else if (status === 404) out = `Gemini model not found. Set GEMINI_MODEL=${DEFAULT_MODEL} (or ${FALLBACK_MODELS[0]}) in .env and restart.`;
  else if (status >= 500) out = `Gemini is having trouble right now (HTTP ${status}). Try again in a moment.`;
  else if (/abort|timed? ?out/i.test(msg) || (err && err.name === 'AbortError')) out = 'Gemini took too long to answer. Try again.';
  else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(msg)) out = 'Could not reach Gemini. Check your internet connection.';
  else out = `Gemini error: ${msg.slice(0, 300) || 'unknown error'}`;
  if (apiKey) out = out.split(apiKey).join('[key]');
  return out;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, clientFactory?: (apiKey: string) => any }} opts
 */
function createGeminiProvider({ env = {}, clientFactory = defaultClientFactory } = {}) {
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  const configured = String(env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
  const candidates = [configured, DEFAULT_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i);
  let model = configured;
  let client = null;

  async function call(params) {
    let lastErr = null;
    for (const m of candidates.slice(candidates.indexOf(model))) {
      try {
        const response = await client.models.generateContent({ ...params, model: m });
        if (m !== model) {
          console.warn(`[core] Gemini model ${model} is not available to this key; using ${m}.`);
          model = m;
        }
        return response;
      } catch (err) {
        lastErr = err;
        if (!isModelUnavailable(err)) break;
      }
    }
    throw lastErr;
  }

  return {
    name: 'gemini',
    get model() {
      return model;
    },
    async generate({ messages, answerStyle }) {
      if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
      const contents = buildContents(messages);
      if (!contents.length) throw new Error('Nothing to send to Gemini.');
      if (!client) client = clientFactory(apiKey);

      let response;
      try {
        response = await call({
          contents,
          config: {
            systemInstruction: systemInstruction(answerStyle),
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        });
      } catch (err) {
        throw new Error(friendlyError(err, apiKey));
      }

      const text = response && typeof response.text === 'string' ? response.text : '';
      if (!text.trim()) {
        const reason = response && response.promptFeedback && response.promptFeedback.blockReason;
        const finish = response && response.candidates && response.candidates[0] && response.candidates[0].finishReason;
        throw new Error(reason || (finish && finish !== 'STOP')
          ? `Gemini returned no answer (${reason || finish}).`
          : 'Gemini returned an empty answer. Try again.');
      }
      return applyStyle(parseReply(text), answerStyle);
    },
  };
}

module.exports = { createGeminiProvider, friendlyError, MISSING_KEY_MESSAGE, DEFAULT_MODEL, FALLBACK_MODELS, RESPONSE_SCHEMA };
