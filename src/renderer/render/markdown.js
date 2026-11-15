// OWNER: Worker 2. Markdown -> DOM for rich replies (SPEC 9.7).
//
// Safety model: the model's Markdown is tokenized with marked, and each token
// type we know is built with createElement / createTextNode from an allow list
// of tags. No HTML string from the model (or from any library) is ever parsed,
// so raw HTML, <script>, event handlers and style attributes can't get in:
// a raw HTML token is shown as its literal text. Links are shown as text.

import { Marked } from '../vendor/marked.esm.js';
import { mathExtensions, renderMath } from './math.js';
import { highlightCode } from './highlight.js';

const MAX_MARKDOWN_LENGTH = 100000;
const MAX_DEPTH = 40;

const marked = new Marked({ gfm: true, breaks: true, async: false });
marked.use({ extensions: mathExtensions });

/** Tokens for a Markdown string (exported for tests). */
export function lex(markdown) {
  return marked.lexer(String(markdown || '').slice(0, MAX_MARKDOWN_LENGTH));
}

/**
 * @typedef {Object} BuildOptions
 * @property {Document} doc
 * @property {Record<string, (text: string, doc: Document) => (Element|null)>} [fences]
 *           renderers for special fenced blocks by language (e.g. plot); return null to fall back to code
 */

function make(doc, tag, className, children = []) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

const text = (doc, s) => doc.createTextNode(String(s == null ? '' : s));

function inline(tokens, opts, depth) {
  const { doc } = opts;
  const out = [];
  if (depth > MAX_DEPTH) return out;
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text':
        out.push(...(t.tokens ? inline(t.tokens, opts, depth + 1) : [text(doc, t.text)]));
        break;
      case 'escape':
        out.push(text(doc, t.text));
        break;
      case 'strong':
        out.push(make(doc, 'strong', null, inline(t.tokens, opts, depth + 1)));
        break;
      case 'em':
        out.push(make(doc, 'em', null, inline(t.tokens, opts, depth + 1)));
        break;
      case 'del':
        out.push(make(doc, 'del', null, inline(t.tokens, opts, depth + 1)));
        break;
      case 'codespan':
        out.push(make(doc, 'code', 'rich-codespan', [text(doc, t.text)]));
        break;
      case 'br':
        out.push(doc.createElement('br'));
        break;
      case 'link': {
        // Shown as text; the address is in the tooltip. Nothing is clickable.
        const span = make(doc, 'span', 'rich-link', inline(t.tokens, opts, depth + 1));
        if (t.href) span.setAttribute('title', String(t.href).slice(0, 500));
        out.push(span);
        break;
      }
      case 'image':
        out.push(make(doc, 'span', 'rich-link', [text(doc, `[image${t.text ? `: ${t.text}` : ''}]`)]));
        break;
      case 'inlineMath':
        out.push(renderMath(t.tex, t.display, doc));
        break;
      case 'checkbox':
        out.push(text(doc, t.checked ? '☑ ' : '☐ '));
        break;
      case 'html':
      default:
        out.push(text(doc, t.raw != null ? t.raw : t.text));
    }
  }
  return out;
}

function codeBlock(t, opts) {
  const { doc } = opts;
  const lang = String(t.lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'math' || lang === 'latex' || lang === 'tex') return renderMath(t.text, true, doc);
  const special = opts.fences && opts.fences[lang];
  if (special) {
    const node = special(t.text, doc);
    if (node) return node;
  }
  const pre = make(doc, 'pre', 'rich-code', [highlightCode(t.text, lang, doc)]);
  if (lang) pre.setAttribute('data-lang', lang.slice(0, 20));
  return pre;
}

function table(t, opts, depth) {
  const { doc } = opts;
  const cell = (c, tag) => {
    const node = make(doc, tag, c.align ? `align-${c.align}` : null, inline(c.tokens, opts, depth + 1));
    return node;
  };
  const head = make(doc, 'thead', null, [make(doc, 'tr', null, t.header.map((c) => cell(c, 'th')))]);
  const body = make(doc, 'tbody', null, t.rows.map((row) => make(doc, 'tr', null, row.map((c) => cell(c, 'td')))));
  return make(doc, 'div', 'rich-table', [make(doc, 'table', null, [head, body])]);
}

function blocks(tokens, opts, depth) {
  const { doc } = opts;
  const out = [];
  if (depth > MAX_DEPTH) return out;
  for (const t of tokens || []) {
    switch (t.type) {
      case 'space':
      case 'def':
        break;
      case 'paragraph':
        out.push(make(doc, 'p', null, inline(t.tokens, opts, depth + 1)));
        break;
      case 'text':
        // Block-level text (tight list items).
        out.push(...(t.tokens ? inline(t.tokens, opts, depth + 1) : [text(doc, t.text)]));
        break;
      case 'heading': {
        // Small panel: Markdown h1/h2 become h3, h3 becomes h4, deeper ones h5.
        const level = t.depth <= 2 ? 3 : t.depth === 3 ? 4 : 5;
        out.push(make(doc, `h${level}`, 'rich-heading', inline(t.tokens, opts, depth + 1)));
        break;
      }
      case 'code':
        out.push(codeBlock(t, opts));
        break;
      case 'blockquote':
        out.push(make(doc, 'blockquote', null, blocks(t.tokens, opts, depth + 1)));
        break;
      case 'list': {
        const list = make(doc, t.ordered ? 'ol' : 'ul', null,
          t.items.map((item) => make(doc, 'li', null, blocks(item.tokens, opts, depth + 1))));
        if (t.ordered && Number.isInteger(t.start) && t.start !== 1) list.setAttribute('start', String(t.start));
        out.push(list);
        break;
      }
      case 'hr':
        out.push(doc.createElement('hr'));
        break;
      case 'table':
        out.push(table(t, opts, depth));
        break;
      case 'blockMath':
        out.push(renderMath(t.tex, true, doc));
        break;
      case 'checkbox':
        out.push(text(doc, t.checked ? '☑ ' : '☐ '));
        break;
      case 'html':
      default:
        // Raw HTML from the model is shown as text, never parsed.
        out.push(make(doc, 'p', null, [text(doc, t.raw != null ? t.raw : t.text)]));
    }
  }
  return out;
}

/**
 * Build the rich DOM for a Markdown string.
 * @param {string} markdown
 * @param {BuildOptions} opts
 * @returns {Element} div.rich
 */
export function buildRich(markdown, opts) {
  const root = make(opts.doc, 'div', 'rich', blocks(lex(markdown), opts, 0));
  return root;
}
