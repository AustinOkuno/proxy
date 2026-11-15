// OWNER: Worker 2. Code highlighting with highlight.js core (SPEC 9.3, 9.7).
// highlight.js returns HTML; we never assign it to innerHTML. Its output only
// ever has <span class="hljs-..."> and escaped text, so spansToNodes rebuilds
// exactly that with DOM calls and turns anything else into plain text.

import hljs from '../vendor/highlight/core.min.js';
import python from '../vendor/highlight/languages/python.min.js';
import javascript from '../vendor/highlight/languages/javascript.min.js';
import c from '../vendor/highlight/languages/c.min.js';
import cpp from '../vendor/highlight/languages/cpp.min.js';
import java from '../vendor/highlight/languages/java.min.js';
import sql from '../vendor/highlight/languages/sql.min.js';
import bash from '../vendor/highlight/languages/bash.min.js';
import json from '../vendor/highlight/languages/json.min.js';

const LANGS = { python, javascript, c, cpp, java, sql, bash, json };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

const MAX_HIGHLIGHT_LENGTH = 50000;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function decode(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, e) => ENTITIES[e]);
}

/**
 * Rebuild highlight.js output as DOM nodes appended to `parent`.
 * @param {string} html
 * @param {Element} parent
 * @param {Document} doc
 */
export function spansToNodes(html, parent, doc) {
  const stack = [parent];
  const re = /<span class="([^"<>]*)">|<\/span>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      const span = doc.createElement('span');
      const classes = m[1].split(/\s+/).filter((k) => /^(hljs-[\w-]+|[\w-]+_)$/.test(k));
      if (classes.length) span.className = classes.join(' ');
      top.appendChild(span);
      stack.push(span);
    } else if (m[0] === '</span>') {
      if (stack.length > 1) stack.pop();
    } else {
      top.appendChild(doc.createTextNode(decode(m[0])));
    }
  }
  return parent;
}

/** A known language name for a fence info string, or null. */
export function languageFor(info) {
  const name = String(info || '').trim().split(/\s+/)[0].toLowerCase();
  if (!name) return null;
  const alias = { js: 'javascript', py: 'python', sh: 'bash', shell: 'bash', 'c++': 'cpp' }[name] || name;
  return hljs.getLanguage(alias) ? alias : null;
}

/**
 * Highlighted <code> element for a code block. Unknown languages and very long
 * code stay plain text.
 */
export function highlightCode(code, info, doc) {
  const el = doc.createElement('code');
  const lang = languageFor(info);
  if (lang) el.className = `language-${lang}`;
  if (!lang || code.length > MAX_HIGHLIGHT_LENGTH) {
    el.textContent = code;
    return el;
  }
  try {
    spansToNodes(hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, el, doc);
  } catch {
    el.textContent = code;
  }
  return el;
}
