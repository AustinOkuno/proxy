'use strict';

/**
 * Gemini adapter (free API key from .env). Implements the provider interface
 * from SPEC.md 4.2: generate({ messages, answerStyle }) -> { answer, explanation }.
 */

const { systemInstruction, buildContents, parseReply, applyStyle } = require('./prompt');
const { createImageShrinker, electronNativeImage } = require('./images');
const { geminiRetryDelayMs } = require('../usage');
const { PROVIDERS } = require('../../../shared/contracts');

// Google limits the 2.5 models to keys that already used them, so new free keys
// get "model not found" for gemini-2.5-flash. Default to a current Flash model and,
// if the configured model is unavailable to this key, try the fallbacks in order.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-latest'];
// One HTTP attempt gives up after this long and counts as a temporary failure.
const TIMEOUT_MS = 60_000;
// Gemini answers 500/503/504 now and then, mostly when it's busy. Retry the same
// model after these delays, then try the next (lighter) model once.
const RETRY_DELAYS_MS = [1_500, 4_000];
// Stop retrying once a request has been going this long; the user can press Retry.
const RETRY_BUDGET_MS = 120_000;
// Hard limit for a whole generate() call, retries and fallbacks included, so a
// hung request can never leave the chat spinning forever.
const DEADLINE_MS = 150_000;
// After falling back because the main model kept failing, stay on the fallback
// this long before trying the main model again, so every message isn't slow.
const STICKY_FALLBACK_MS = 10 * 60_000;
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

const STOPPED_MESSAGE = 'Stopped.';

/** Error thrown when the caller's AbortSignal fires (the user pressed Stop). */
function stoppedError() {
  const err = new Error(STOPPED_MESSAGE);
  err.name = 'AbortError';
  err.stopped = true;
  return err;
}

function deadlineMessage(ms) {
  const secs = Math.max(1, Math.round(ms / 1000));
  const when = secs < 120 ? `${secs} second${secs === 1 ? '' : 's'}` : `${Math.round(secs / 6) / 10} minutes`;
  return `Gemini didn't answer within ${when}, so the request was stopped. Press Retry to try again.`;
}

/** Reject as soon as `signal` aborts, even if `promise` never settles (e.g. an SDK that ignores aborts). */
function raceAbort(promise, signal, makeError) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(makeError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

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

/** Errors worth retrying: Gemini overloaded or slow, or the connection dropped. */
function isTransient(err) {
  if (errStatus(err) >= 500) return true;
  const msg = String((err && err.message) || '');
  return (err && err.name === 'AbortError') || /abort|timed? ?out|ECONNRESET|socket hang up|UND_ERR/i.test(msg);
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
  else if (status >= 500) out = `Gemini is busy or having trouble right now (HTTP ${status}), even after retrying. Press Retry in a moment.`;
  else if (/abort|timed? ?out/i.test(msg) || (err && err.name === 'AbortError')) out = 'Gemini took too long to answer, even after retrying. Press Retry.';
  else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(msg)) out = 'Could not reach Gemini. Check your internet connection.';
  else out = `Gemini error: ${msg.slice(0, 300) || 'unknown error'}`;
  if (apiKey) out = out.split(apiKey).join('[key]');
  return out;
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   clientFactory?: (apiKey: string) => any,
 *   shrinkImage?: (img: object) => object,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   logger?: Pick<Console,'warn'>,
 *   deadlineMs?: number,
 * }} opts
 */
function createGeminiProvider({
  env = {},
  clientFactory = defaultClientFactory,
  shrinkImage = createImageShrinker({ nativeImage: electronNativeImage() }),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  logger = console,
  deadlineMs = DEADLINE_MS,
  usage = null,
} = {}) {
  const meter = (fn) => {
    if (!usage) return;
    try { fn(usage); } catch (err) { logger.warn(`[core] usage update failed: ${err.message}`); }
  };
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  const configured = String(env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
  const candidates = [configured, DEFAULT_MODEL, ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i);
  let model = configured;
  let client = null;
  /** Temporary fallback after repeated 5xx/timeouts: { model, until }. */
  let sticky = null;

  /** One model, retried with backoff while the errors look temporary. */
  async function callModel(m, params, start, signal) {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw stoppedError();
      try {
        const response = await client.models.generateContent({ ...params, model: m, config: { ...params.config, abortSignal: signal } });
        const um = (response && response.usageMetadata) || {};
        meter((u) => u.recordRequest(PROVIDERS.GEMINI, { inputTokens: um.promptTokenCount, outputTokens: um.candidatesTokenCount }));
        return response;
      } catch (err) {
        if (signal.aborted) throw err;
        // Every request counts against the quota, even a failed one. A 429 also
        // marks the meter limited until the retry delay Gemini gave (a zero
        // limit means no access to this model at all, not a rate limit).
        meter((u) => u.recordRequest(PROVIDERS.GEMINI));
        if (errStatus(err) === 429 && !isNoFreeQuota(err)) meter((u) => u.markLimited(PROVIDERS.GEMINI, now() + geminiRetryDelayMs(err)));
        const delay = RETRY_DELAYS_MS[attempt];
        if (!isTransient(err) || delay === undefined || now() - start + delay > RETRY_BUDGET_MS) throw err;
        logger.warn(`[core] Gemini ${m} failed (${errStatus(err) || err.message}); retrying in ${delay} ms.`);
        await raceAbort(sleep(delay), signal, stoppedError);
      }
    }
  }

  /**
   * Try the current model, then the next ones: permanently when a model isn't
   * available to this key, and for STICKY_FALLBACK_MS when Gemini keeps failing.
   */
  async function call(params, signal) {
    const start = now();
    if (sticky && start >= sticky.until) sticky = null;
    const from = sticky ? sticky.model : model;
    const list = candidates.slice(Math.max(candidates.indexOf(model), candidates.indexOf(from)));
    let skippedOnlyUnavailable = true;
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      try {
        const response = await callModel(m, params, start, signal);
        if (m !== from && skippedOnlyUnavailable && !sticky) {
          logger.warn(`[core] Gemini model ${model} is not available to this key; using ${m}.`);
          model = m;
        } else if (m !== from) {
          sticky = { model: m, until: now() + STICKY_FALLBACK_MS };
        }
        return { response, model: m };
      } catch (err) {
        lastErr = err;
        if (signal.aborted) break;
        if (isModelUnavailable(err)) continue;
        if (isTransient(err) && i + 1 < list.length && now() - start < RETRY_BUDGET_MS) {
          skippedOnlyUnavailable = false;
          logger.warn(`[core] Gemini ${m} keeps failing; trying ${list[i + 1]}.`);
          continue;
        }
        break;
      }
    }
    throw lastErr;
  }

  function shrinkMessages(messages) {
    return messages.map((msg) => (Array.isArray(msg.images) && msg.images.length
      ? { ...msg, images: msg.images.map((img) => shrinkImage(img)) }
      : msg));
  }

  return {
    name: 'gemini',
    get model() {
      return model;
    },
    /**
     * @param {{ messages: object[], answerStyle: string, signal?: AbortSignal }} req
     *   signal: abort to stop the request (and any retries). generate() then
     *   rejects with an error whose `stopped` is true.
     */
    async generate({ messages, answerStyle, signal } = {}) {
      if (signal && signal.aborted) throw stoppedError();
      if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
      const contents = buildContents(shrinkMessages(messages || []));
      if (!contents.length) throw new Error('Nothing to send to Gemini.');
      if (!client) client = clientFactory(apiKey);

      // One controller for this call: the user's Stop and the overall deadline
      // both abort it, which cancels the HTTP request and any pending retry.
      const ctl = new AbortController();
      let timedOut = false;
      const onStop = () => ctl.abort();
      if (signal) signal.addEventListener('abort', onStop, { once: true });
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, deadlineMs);
      const abortError = () => (timedOut ? new Error(deadlineMessage(deadlineMs)) : stoppedError());

      let response;
      let usedModel = model;
      try {
        ({ response, model: usedModel } = await raceAbort(call({
          contents,
          config: {
            systemInstruction: systemInstruction(answerStyle),
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }, ctl.signal), ctl.signal, abortError));
      } catch (err) {
        if (ctl.signal.aborted) throw abortError();
        throw new Error(friendlyError(err, apiKey));
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onStop);
      }

      const text = response && typeof response.text === 'string' ? response.text : '';
      if (!text.trim()) {
        const reason = response && response.promptFeedback && response.promptFeedback.blockReason;
        const finish = response && response.candidates && response.candidates[0] && response.candidates[0].finishReason;
        throw new Error(reason || (finish && finish !== 'STOP')
          ? `Gemini returned no answer (${reason || finish}).`
          : 'Gemini returned an empty answer. Try again.');
      }
      return { ...applyStyle(parseReply(text), answerStyle), model: usedModel };
    },
  };
}

module.exports = {
  createGeminiProvider,
  friendlyError,
  MISSING_KEY_MESSAGE,
  STOPPED_MESSAGE,
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  RESPONSE_SCHEMA,
  RETRY_DELAYS_MS,
  STICKY_FALLBACK_MS,
  DEADLINE_MS,
  deadlineMessage,
  isTransient,
};
