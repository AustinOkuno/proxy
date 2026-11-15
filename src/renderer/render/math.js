// OWNER: Worker 2. Math for rich replies (SPEC 9.7): finding $...$, $$...$$,
// \(...\), \[...\] and bare \ce{...} in Markdown, and turning TeX into MathML
// with Temml (Chromium renders MathML natively, so no CSP change).

import temml from '../vendor/temml-mhchem.js';

const MAX_TEX_LENGTH = 4000;

/** Index of the brace that closes the one at `open`, or -1. */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Find math at the very start of `src` (inline context).
 * @returns {{ raw: string, tex: string, display: boolean } | null}
 */
export function matchInlineMath(src) {
  let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
  if (m) return { raw: m[0], tex: m[1].trim(), display: true };
  m = /^\\\[([\s\S]+?)\\\]/.exec(src);
  if (m) return { raw: m[0], tex: m[1].trim(), display: true };
  m = /^\\\(([\s\S]+?)\\\)/.exec(src);
  if (m) return { raw: m[0], tex: m[1].trim(), display: false };
  // $x$: no space just inside the dollars and no digit right after the closing
  // one, so "costs $5 and $10" stays text (the Pandoc rule).
  m = /^\$(?![\s$])((?:\\[\s\S]|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
  if (m) return { raw: m[0], tex: m[1], display: false };
  if (src.startsWith('\\ce{') || src.startsWith('\\pu{')) {
    const end = matchBrace(src, 3);
    if (end > 0) return { raw: src.slice(0, end + 1), tex: src.slice(0, end + 1), display: false };
  }
  return null;
}

/** Where the next possible inline math starts in `src`, or undefined. */
export function inlineMathStart(src) {
  const idx = [src.indexOf('$'), src.indexOf('\\('), src.indexOf('\\['), src.indexOf('\\ce{'), src.indexOf('\\pu{')]
    .filter((i) => i >= 0);
  return idx.length ? Math.min(...idx) : undefined;
}

/**
 * Display math as its own block: a paragraph that is only $$...$$ or \[...\].
 * @returns {{ raw: string, tex: string } | null}
 */
export function matchBlockMath(src) {
  const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(src);
  if (!m) return null;
  return { raw: m[0], tex: (m[1] || m[2]).trim() };
}

/** marked extensions that produce blockMath / inlineMath tokens ({ tex, display }). */
export const mathExtensions = [
  {
    name: 'blockMath',
    level: 'block',
    start: (src) => {
      const idx = [src.indexOf('$$'), src.indexOf('\\[')].filter((i) => i >= 0);
      return idx.length ? Math.min(...idx) : undefined;
    },
    tokenizer(src) {
      const m = matchBlockMath(src);
      return m ? { type: 'blockMath', raw: m.raw, tex: m.tex, display: true } : undefined;
    },
  },
  {
    name: 'inlineMath',
    level: 'inline',
    start: inlineMathStart,
    tokenizer(src) {
      const m = matchInlineMath(src);
      return m ? { type: 'inlineMath', raw: m.raw, tex: m.tex, display: m.display } : undefined;
    },
  },
];

/** Remove style attributes Temml may set (the CSP blocks them anyway). */
function stripStyles(node) {
  if (node.getAttribute && node.getAttribute('style') != null) node.removeAttribute('style');
  for (const c of [...(node.childNodes || [])]) stripStyles(c);
}

/**
 * Render TeX to MathML inside a span.rich-math (div for display math). Bad TeX
 * comes back as its source text with class rich-math-error, never an exception.
 * @param {string} tex
 * @param {boolean} display
 * @param {Document} doc
 */
export function renderMath(tex, display, doc) {
  const wrap = doc.createElement(display ? 'div' : 'span');
  wrap.className = display ? 'rich-math display' : 'rich-math';
  const source = String(tex || '');
  try {
    if (!source.trim() || source.length > MAX_TEX_LENGTH) throw new Error('empty or too long');
    temml.render(source, wrap, {
      displayMode: display,
      throwOnError: true,
      trust: false, // no \href, \url, \includegraphics
      annotate: true, // keeps the TeX inside the MathML, so copying the text still works
    });
    stripStyles(wrap);
  } catch {
    wrap.textContent = display ? `$$${source}$$` : `$${source}$`;
    wrap.className += ' rich-math-error';
    wrap.setAttribute('title', "Couldn't render this equation");
  }
  return wrap;
}
