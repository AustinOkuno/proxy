'use strict';

/**
 * Provider-neutral prompt building and reply parsing. Electron-free and
 * SDK-free so it can be unit-tested.
 */

const { ANSWER_STYLES } = require('../../../shared/contracts');

const BASE_INSTRUCTION = [
  'You are Proxy, a desktop assistant. The user sends questions and screenshots of their screen.',
  'If a message is only a screenshot with no text, work out what the user most likely wants from it',
  '(for example: answer the question shown, explain the error, summarise the content) and do that.',
  'Reply as a JSON object with exactly two string fields:',
  '"answer": the direct answer, short and to the point (the final result, value, choice, fix or command).',
  '"explanation": the reasoning or steps that justify the answer.',
  'Both fields may use plain Markdown. Do not repeat the answer at length inside the explanation.',
].join('\n');

const STYLE_HINT = {
  [ANSWER_STYLES.ANSWER]: 'The user only wants the answer. Put it in "answer" and leave "explanation" as an empty string.',
  [ANSWER_STYLES.EXPLANATION]: 'The user only wants the explanation. Put a full explanation in "explanation" and leave "answer" as an empty string.',
  [ANSWER_STYLES.BOTH]: 'Fill in both "answer" and "explanation".',
};

function systemInstruction(answerStyle) {
  return `${BASE_INSTRUCTION}\n${STYLE_HINT[answerStyle] || STYLE_HINT[ANSWER_STYLES.BOTH]}`;
}

/** Text an earlier assistant turn is sent back to the model as. */
function assistantTurnText(m) {
  return JSON.stringify({ answer: m.answer || '', explanation: m.explanation || '' });
}

/**
 * Convert session messages into Gemini `contents`. Failed assistant turns are
 * dropped, and consecutive turns from the same role are merged (the API wants
 * user/model to alternate).
 * @param {import('../../../shared/contracts').Message[]} messages
 */
function buildContents(messages) {
  const contents = [];
  for (const m of messages || []) {
    let role;
    const parts = [];
    if (m.role === 'user') {
      role = 'user';
      for (const img of m.images || []) {
        if (img && typeof img.dataBase64 === 'string' && img.dataBase64) {
          parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.dataBase64 } });
        }
      }
      if (m.text && m.text.trim()) parts.push({ text: m.text });
    } else if (m.role === 'assistant') {
      if (m.error) continue;
      if (!m.answer && !m.explanation) continue;
      role = 'model';
      parts.push({ text: assistantTurnText(m) });
    } else {
      continue;
    }
    if (!parts.length) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  // The conversation must start with the user.
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

/** Strip a ```json ... ``` fence if the model added one. */
function stripFence(text) {
  const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(text);
  return m ? m[1] : text;
}

/**
 * Parse the model's text into { answer, explanation }. Falls back to putting
 * the whole text in `answer` if it isn't the expected JSON.
 * @returns {import('../../../shared/contracts').ProviderReply}
 */
function parseReply(text) {
  const raw = String(text == null ? '' : text);
  try {
    const obj = JSON.parse(stripFence(raw));
    if (obj && typeof obj === 'object' && !Array.isArray(obj)
      && (typeof obj.answer === 'string' || typeof obj.explanation === 'string')) {
      return {
        answer: typeof obj.answer === 'string' ? obj.answer.trim() : '',
        explanation: typeof obj.explanation === 'string' ? obj.explanation.trim() : '',
      };
    }
  } catch { /* fall through */ }
  return { answer: raw.trim(), explanation: '' };
}

/** Enforce the answer style on a parsed reply. */
function applyStyle(reply, answerStyle) {
  let { answer, explanation } = reply;
  if (answerStyle === ANSWER_STYLES.ANSWER) {
    if (!answer) answer = explanation; // don't show an empty bubble
    explanation = '';
  } else if (answerStyle === ANSWER_STYLES.EXPLANATION) {
    if (!explanation) explanation = answer;
    answer = '';
  }
  return { answer, explanation };
}

module.exports = { systemInstruction, buildContents, parseReply, applyStyle, assistantTurnText };
