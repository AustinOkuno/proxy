import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument } from './fakedom.js';
import { renderRich } from '../../../src/renderer/render/index.js';
import { matchInlineMath, matchBlockMath } from '../../../src/renderer/render/math.js';
import { spansToNodes, languageFor } from '../../../src/renderer/render/highlight.js';

const doc = installFakeDocument();
const render = (md, kind = 'explanation') => renderRich(md, { kind, doc });
const html = (md, kind) => render(md, kind).outerHTML;

/** Every element in the tree, including the root. */
function allElements(root) {
  return [root, ...root.findAll(() => true)];
}

// --- sanitizing -------------------------------------------------------------

test('raw HTML from the model is shown as text, never as elements', () => {
  const root = render('Hi <script>alert(1)</script> and <img src=x onerror="alert(2)"> <b style="color:red">b</b>\n\n<div onclick="x()">block</div>');
  const tags = allElements(root).map((e) => e.localName);
  for (const bad of ['script', 'img', 'b', 'div']) {
    if (bad === 'div') assert.equal(tags.filter((t) => t === 'div').length, 1, 'only the .rich root is a div');
    else assert.ok(!tags.includes(bad), `no <${bad}>`);
  }
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /<div onclick="x\(\)">block<\/div>/);
});

test('no event handler, style, href or src attributes anywhere in the output', () => {
  const md = [
    '# Title <span onmouseover="x">t</span>',
    '[click](javascript:alert(1)) ![pic](http://evil/x.png "t")',
    '```python\nprint("<b onclick=1>")\n```',
    '| a | b |\n|:--|--:|\n| <i style="x">1</i> | $x^2$ |',
    '$$\\color{red}{x}$$',
    '$\\href{javascript:alert(1)}{x}$',
  ].join('\n\n');
  for (const e of allElements(render(md))) {
    for (const k of e.attributes.keys()) {
      assert.ok(!/^on/i.test(k), `${e.localName} has ${k}`);
      assert.ok(!['style', 'href', 'src', 'xlink:href'].includes(k), `${e.localName} has ${k}`);
    }
  }
});

test('links are text with the address in the tooltip', () => {
  const link = render('see [the docs](https://example.com/x)').querySelector('span.rich-link');
  assert.equal(link.textContent, 'the docs');
  assert.equal(link.getAttribute('title'), 'https://example.com/x');
});

test('rendering errors fall back to plain text instead of throwing', () => {
  const broken = { createElement() { throw new Error('boom'); }, createTextNode: (t) => ({ t }) };
  let root;
  const warn = console.warn;
  console.warn = () => {};
  try {
    // A doc whose createElement throws once, then works for the fallback.
    let calls = 0;
    const flaky = {
      ...doc,
      createElement: (tag) => {
        calls += 1;
        if (calls === 1) return broken.createElement(tag);
        return doc.createElement(tag);
      },
    };
    root = renderRich('**hi** $x$', { kind: 'answer', doc: flaky });
  } finally {
    console.warn = warn;
  }
  assert.equal(root.textContent, '**hi** $x$');
  assert.ok(root.classList.contains('rich-plain'));
  assert.ok(root.classList.contains('rich-answer'));
});

test('empty and non-string input give an empty .rich element', () => {
  assert.equal(render('').textContent, '');
  assert.equal(render(null).textContent, '');
  assert.ok(render(undefined).classList.contains('rich'));
});

// --- Markdown ---------------------------------------------------------------

test('root carries rich and the kind class', () => {
  assert.ok(render('x', 'answer').classList.contains('rich-answer'));
  assert.ok(render('x').classList.contains('rich-explanation'));
});

test('headings, lists, bold, italics, code spans, quotes and rules', () => {
  const out = html('## Steps\n\n1. **Find** moles\n2. *Divide*\n\n- a\n- `b<c`\n\n> note\n\n---');
  assert.match(out, /<h3 class="rich-heading">Steps<\/h3>/);
  assert.match(out, /<ol><li><strong>Find<\/strong> moles<\/li><li><em>Divide<\/em><\/li><\/ol>/);
  assert.match(out, /<code class="rich-codespan">b&lt;c<\/code>/);
  assert.match(out, /<blockquote><p>note<\/p><\/blockquote>/);
  assert.match(out, /<hr><\/hr>/);
});

test('ordered lists keep their start number', () => {
  assert.match(html('3. three\n4. four'), /<ol start="3">/);
});

test('tables get a .rich-table wrapper and alignment classes', () => {
  const root = render('| Species | M (g/mol) |\n|:--|--:|\n| H2O | 18.02 |');
  const wrap = root.querySelector('div.rich-table');
  assert.ok(wrap);
  assert.equal(wrap.querySelectorAll('th').length, 2);
  assert.ok(wrap.querySelector('td.align-right'));
  assert.equal(wrap.querySelectorAll('td')[1].textContent, '18.02');
});

test('line breaks inside a paragraph are kept', () => {
  assert.equal(render('a\nb').querySelectorAll('br').length, 1);
});

// --- code -------------------------------------------------------------------

test('fenced code with a known language is highlighted with spans', () => {
  const pre = render('```python\ndef f(x):\n    return "<a>"  # c\n```').querySelector('pre.rich-code');
  assert.equal(pre.getAttribute('data-lang'), 'python');
  const code = pre.querySelector('code');
  assert.ok(code.classList.contains('language-python'));
  assert.ok(code.querySelector('span.hljs-keyword'));
  assert.ok(code.querySelector('span.hljs-comment'));
  assert.equal(code.textContent, 'def f(x):\n    return "<a>"  # c');
});

test('unknown languages and plain fences stay plain text', () => {
  const code = render('```cobol\nMOVE A TO B.\n```').querySelector('code');
  assert.equal(code.childNodes.length, 1);
  assert.equal(code.textContent, 'MOVE A TO B.');
  assert.equal(render('```\n<b>x</b>\n```').querySelector('code').textContent, '<b>x</b>');
});

test('language aliases resolve', () => {
  assert.equal(languageFor('py'), 'python');
  assert.equal(languageFor('JS'), 'javascript');
  assert.equal(languageFor('sh'), 'bash');
  assert.equal(languageFor('brainfuck'), null);
  assert.equal(languageFor(''), null);
});

test('spansToNodes only rebuilds spans and text', () => {
  const box = doc.createElement('code');
  spansToNodes('<span class="hljs-string evil">&quot;a&lt;b&quot;</span><img src=x onerror=1><span class="hljs-x">y', box, doc);
  assert.equal(box.findAll(() => true).map((e) => e.localName).join(','), 'span,span');
  assert.equal(box.querySelector('span').className, 'hljs-string');
  assert.equal(box.textContent, '"a<b"<img src=x onerror=1>y');
});

// --- math -------------------------------------------------------------------

test('$x^2$ renders as inline MathML', () => {
  const m = render('Area is $x^2$.').querySelector('span.rich-math');
  assert.ok(m, 'has .rich-math');
  const math = m.querySelector('math');
  assert.ok(math, 'has <math>');
  assert.equal(math.namespaceURI, 'http://www.w3.org/1998/Math/MathML');
  assert.ok(math.querySelector('msup'));
});

test('$$\\frac{a}{b}$$ renders as display MathML', () => {
  const m = render('$$\\frac{a}{b}$$').querySelector('div.rich-math');
  assert.ok(m.classList.contains('display'));
  assert.ok(m.querySelector('mfrac'));
  assert.equal(m.querySelector('math').getAttribute('display'), 'block');
});

test('\\ce{H2O} renders as MathML, inside $...$ and bare', () => {
  for (const md of ['Water is $\\ce{H2O}$.', 'Water is \\ce{H2O}.']) {
    const m = render(md).querySelector('span.rich-math');
    assert.ok(m && m.querySelector('math'), md);
    assert.ok(m.querySelector('msub'), `${md}: subscript 2`);
  }
});

test('the demo equation renders with an arrow', () => {
  const m = render('$\\ce{2H2 + O2 -> 2H2O}$', 'answer').querySelector('span.rich-math');
  assert.ok(m.querySelector('math'));
  assert.ok(!m.classList.contains('rich-math-error'));
  assert.match(m.textContent, /→|⟶/);
});

test('\\(...\\), \\[...\\] and ```math fences render too', () => {
  assert.ok(render('so \\(a+b\\) is').querySelector('span.rich-math').querySelector('math'));
  assert.ok(render('\\[a=b\\]').querySelector('div.rich-math').querySelector('math'));
  assert.ok(render('```math\nE = mc^2\n```').querySelector('div.rich-math').querySelector('math'));
});

test('math is not mangled by Markdown (underscores, asterisks, backslashes)', () => {
  const m = render('$a_1 * b_2 * c$').querySelector('span.rich-math');
  assert.ok(m.querySelector('math'));
  assert.equal(render('$a_1 * b_2 * c$').querySelectorAll('em').length, 0);
});

test('bad TeX shows its source with an error class, not a crash', () => {
  const m = render('$\\frac{1}{$ and more').querySelector('span.rich-math');
  if (m) {
    assert.ok(m.classList.contains('rich-math-error'));
    assert.match(m.textContent, /\\frac/);
  }
  const bad = render('$\\notacommand{x}$').querySelector('span.rich-math');
  assert.ok(bad.classList.contains('rich-math-error'));
  assert.equal(bad.textContent, '$\\notacommand{x}$');
});

test('dollar amounts stay text', () => {
  const root = render('It costs $5 and $10 today.');
  assert.equal(root.querySelectorAll('span.rich-math').length, 0);
  assert.equal(root.textContent, 'It costs $5 and $10 today.');
  assert.equal(matchInlineMath('$ 5 $'), null);
  assert.equal(matchInlineMath('$5$0'), null);
});

test('matchInlineMath and matchBlockMath', () => {
  assert.deepEqual(matchInlineMath('$x$ rest'), { raw: '$x$', tex: 'x', display: false });
  assert.deepEqual(matchInlineMath('\\ce{A{B}} rest'), { raw: '\\ce{A{B}}', tex: '\\ce{A{B}}', display: false });
  assert.equal(matchInlineMath('\\ce{unclosed'), null);
  assert.deepEqual(matchBlockMath('$$\na\n$$\nmore'), { raw: '$$\na\n$$\n', tex: 'a' });
  assert.equal(matchBlockMath('text $$a$$'), null);
});
