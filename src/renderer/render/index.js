// OWNER: Worker 2 (UI phase). Rich reply rendering: Markdown, math, code, plots (SPEC 9.7).

import { buildRich } from './markdown.js';

/**
 * Render a reply section. Never throws: if anything goes wrong the text is
 * shown as plain text.
 * @param {string} markdown
 * @param {{ kind?: 'answer'|'explanation', doc?: Document }} [opts]
 * @returns {HTMLElement}  a sanitized element with class "rich"
 */
export function renderRich(markdown, opts = {}) {
  const doc = opts.doc || document;
  const kind = opts.kind === 'answer' ? 'answer' : 'explanation';
  let root;
  try {
    root = buildRich(markdown, { doc });
  } catch (err) {
    console.warn('[render] falling back to plain text:', err);
    root = doc.createElement('div');
    root.className = 'rich rich-plain';
    root.textContent = String(markdown || '');
  }
  root.className += ` rich-${kind}`;
  return root;
}
