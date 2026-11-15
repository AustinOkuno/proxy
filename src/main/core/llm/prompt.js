'use strict';

/**
 * Provider-neutral prompt building and reply parsing. Electron-free and
 * SDK-free so it can be unit-tested.
 */

const { ANSWER_STYLES } = require('../../../shared/contracts');

/** How to format the text inside answer and explanation (SPEC 9.7). */
const FORMAT_INSTRUCTION = [
  'Both fields are Markdown: headings, lists, tables and bold are fine. Raw HTML is shown as plain text, so do not use it.',
  'Math: $...$ inline and $$...$$ for a displayed equation, in LaTeX (for example $\\frac{a}{b}$, $x^2$).',
  'Chemistry: \\ce{...} inside math, for example $\\ce{2H2 + O2 -> 2H2O}$ or $\\ce{SO4^2-}$.',
  'Code: fenced code blocks with a language, for example ```python.',
  'Graphs: when a graph helps (a curve, a titration, data points), add a fenced block with language plot holding JSON:',
  '{"title": "...", "x": {"label": "...", "min": 0, "max": 50}, "y": {"label": "...", "min": 0, "max": 14},',
  ' "series": [{"label": "fit", "fn": "7 + 6*atan((x-25)/2)/pi"}, {"label": "data", "points": [[0,1.2],[25,7]]}]}.',
  'fn is an expression in x using + - * / ^, parentheses, pi, e, sin cos tan asin acos atan sqrt abs ln log exp.',
  'Because the reply is JSON, every backslash inside the strings must be escaped (write \\\\frac, \\\\ce).',
].join('\n');

const BASE_INSTRUCTION = [
  'You are Proxy, a study tutor in a small panel beside the user\'s work (often chemistry practice problems).',
  'The user sends questions and screenshots of their screen.',
  'If a message is only a screenshot with no text, work out what the user most likely wants from it',
  '(for example: answer the question shown, explain the error, summarise the content) and do that.',
  'Reply as a JSON object with exactly two string fields:',
  '"answer": the shortest complete result, shown big at the top: a number with units, a balanced equation,',
  'a choice letter, a fix or a command. One line when possible; no steps or reasoning here.',
  '"explanation": the steps that get to the answer, short and clear, shown smaller under it.',
  'Do not repeat the answer at length inside the explanation.',
  FORMAT_INSTRUCTION,
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
 * Undo the usual way a model breaks LaTeX inside JSON: writing \frac instead of
 * \\frac. JSON reads "\f", "\b", "\t", "\r" as control characters, which never
 * belong in a reply, so a control character followed by a letter goes back to
 * a backslash and the letter. ("\n" is left alone: it is a real newline far more often.)
 */
function repairLatex(s) {
  return s
    .replace(/\f/g, '\\f')
    .replace(/\x08/g, '\\b')
    .replace(/\t(?=[a-z])/g, '\\t')
    .replace(/\r(?=[a-z])/g, '\\r');
}

/** Escape backslashes that don't start a valid JSON escape (\ce, \sqrt, \alpha ...). */
function escapeStrayBackslashes(text) {
  return text.replace(/\\(\\|["/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m, ok) => (ok ? m : '\\\\'));
}

function tryParse(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)
      && (typeof obj.answer === 'string' || typeof obj.explanation === 'string')) {
      return obj;
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Parse the model's text into { answer, explanation }. Falls back to putting
 * the whole text in `answer` if it isn't the expected JSON.
 * @returns {import('../../../shared/contracts').ProviderReply}
 */
function parseReply(text) {
  const raw = String(text == null ? '' : text);
  const body = stripFence(raw);
  const obj = tryParse(body) || tryParse(escapeStrayBackslashes(body));
  if (obj) {
    const field = (v) => (typeof v === 'string' ? repairLatex(v).trim() : '');
    return { answer: field(obj.answer), explanation: field(obj.explanation) };
  }
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

module.exports = { FORMAT_INSTRUCTION, systemInstruction, buildContents, parseReply, applyStyle, assistantTurnText };
