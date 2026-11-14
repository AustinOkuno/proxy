'use strict';

/**
 * Provider registry. Add another model by writing an adapter with the same
 * generate({ messages, answerStyle }) -> { answer, explanation } method and
 * registering it here (plus a PROVIDERS value in contracts.js via the lead).
 */

const { PROVIDERS } = require('../../../shared/contracts');
const { createGeminiProvider } = require('./gemini');
const { createClaudeProvider } = require('./claude');

const FACTORIES = {
  [PROVIDERS.GEMINI]: createGeminiProvider,
  [PROVIDERS.CLAUDE_PRO]: createClaudeProvider,
};

/**
 * @param {string} name   PROVIDERS value
 * @param {{ env?: NodeJS.ProcessEnv, settings?: { get(): object }, clientFactory?: Function }} opts
 */
function createProvider(name, opts = {}) {
  const factory = FACTORIES[name];
  if (!factory) throw new Error(`Unknown model provider: ${name}`);
  return factory(opts);
}

module.exports = { createProvider };
