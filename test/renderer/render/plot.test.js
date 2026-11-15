import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './fakedom.js';
import { compileExpression, ExprError } from '../../../src/renderer/render/expr.js';
import { parsePlot, drawPlot, niceTicks, formatTick, PlotError } from '../../../src/renderer/render/plot.js';
import { renderRich } from '../../../src/renderer/render/index.js';

const doc = createFakeDocument();
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const SPEC_EXAMPLE = {
  title: 'Titration curve',
  x: { label: 'mL NaOH', min: 0, max: 50 },
  y: { label: 'pH', min: 0, max: 14 },
  series: [
    { label: 'fit', fn: '7 + 6*atan((x-25)/2)/pi' },
    { label: 'data', points: [[0, 1.2], [10, 1.8], [25, 7], [40, 12.1]] },
  ],
};

// --- expressions ------------------------------------------------------------

test('arithmetic, precedence and associativity', () => {
  near(compileExpression('1 + 2 * 3')(0), 7);
  near(compileExpression('(1 + 2) * 3')(0), 9);
  near(compileExpression('2^3^2')(0), 512);
  near(compileExpression('-x^2')(3), -9);
  near(compileExpression('10 / 4 / 5')(0), 0.5);
  near(compileExpression('1.5e2 + .5')(0), 150.5);
  near(compileExpression('- - x')(4), 4);
});

test('x, constants, functions and implicit multiplication', () => {
  near(compileExpression('2x + 1')(3), 7);
  near(compileExpression('3(x+1)')(1), 6);
  near(compileExpression('2sin(pi/2)')(0), 2);
  near(compileExpression('e')(0), Math.E);
  near(compileExpression('ln(e) + log(100) + exp(0)')(0), 4);
  near(compileExpression('sqrt(abs(-16))')(0), 4);
  near(compileExpression('asin(1) + acos(1) + atan(0) + cos(0) + tan(0)')(0), Math.PI / 2 + 1);
  near(compileExpression('7 + 6*atan((x-25)/2)/pi')(25), 7);
  near(compileExpression('SIN(X)')(0), 0);
});

test('anything that is not math is rejected', () => {
  const bad = [
    'alert(1)', 'x; 1', 'constructor', 'window.close()', '__proto__', 'x[0]', '"a"', 'x = 1',
    'process.exit()', 'Function("x")', 'this', '1 +', '(1', '1)', 'sin x', 'sin()', '', '   ',
    '2 ** 3', 'x,y', 'y', '`x`', '1 & 2', 'Math.PI', 'x'.repeat(501),
  ];
  for (const src of bad) assert.throws(() => compileExpression(src), ExprError, JSON.stringify(src));
  assert.throws(() => compileExpression(42), ExprError);
  assert.throws(() => compileExpression(`${'('.repeat(100)}x${')'.repeat(100)}`), ExprError);
});

// --- plot specs -------------------------------------------------------------

test('the SPEC 9.7 example parses', () => {
  const p = parsePlot(JSON.stringify(SPEC_EXAMPLE));
  assert.equal(p.title, 'Titration curve');
  assert.deepEqual(p.x, { label: 'mL NaOH', min: 0, max: 50 });
  assert.deepEqual(p.y, { label: 'pH', min: 0, max: 14 });
  assert.equal(p.series[0].kind, 'fn');
  assert.ok(p.series[0].points.length > 100);
  near(p.series[0].points[p.series[0].points.length / 2 | 0][1], 7, 1e-6);
  assert.equal(p.series[1].kind, 'points');
  assert.equal(p.series[1].points.length, 4);
});

test('the SPEC 9.7 example draws an SVG with a curve, 4 points, axes and a legend', () => {
  const fig = drawPlot(parsePlot(SPEC_EXAMPLE), doc);
  assert.equal(fig.localName, 'figure');
  assert.ok(fig.classList.contains('rich-plot'));
  assert.equal(fig.querySelector('figcaption').textContent, 'Titration curve');
  const svg = fig.querySelector('svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.querySelectorAll('polyline').length, 1);
  assert.equal(svg.querySelectorAll('circle').length, 4);
  const labels = svg.querySelectorAll('text').map((t) => t.textContent);
  assert.ok(labels.includes('mL NaOH'));
  assert.ok(labels.includes('pH'));
  assert.ok(labels.includes('50'));
  assert.deepEqual(fig.querySelectorAll('span.rich-plot-key').map((k) => k.textContent), ['fit', 'data']);
  for (const e of fig.findAll(() => true)) {
    assert.ok(!e.hasAttribute('style'));
    for (const k of e.attributes.keys()) assert.ok(!/^on/.test(k));
  }
});

test('ranges are worked out when missing', () => {
  const p = parsePlot({ series: [{ points: [[1, 10], [3, 30]] }] });
  assert.deepEqual([p.x.min, p.x.max], [1, 3]);
  assert.ok(p.y.min < 10 && p.y.max > 30);
  const q = parsePlot({ x: { min: -1, max: 1 }, series: [{ fn: '5' }] });
  assert.ok(q.y.min < 5 && q.y.max > 5, 'flat line gets some room');
});

test('asymptotes break the line instead of drawing a spike', () => {
  const fig = drawPlot(parsePlot({ x: { min: -2, max: 2 }, y: { min: -5, max: 5 }, series: [{ fn: '1/x' }] }), doc);
  assert.equal(fig.querySelectorAll('polyline').length, 2);
});

test('bad specs throw readable PlotErrors', () => {
  const cases = [
    ['{not json', /not valid JSON/],
    ['[]', /JSON object/],
    [{ series: [] }, /no series/],
    [{ series: [{ fn: 'import("x")' }] }, /Unknown name|Unexpected/],
    [{ x: { min: 5, max: 1 }, series: [{ fn: 'x' }] }, /x.max/],
    [{ series: [{ label: 'a' }] }, /needs "fn" or "points"/],
    [{ series: [{ points: [['a', 1]] }] }, /no valid points/],
    [{ x: { min: 0, max: 1 }, series: [{ fn: 'sqrt(-1-x)' }] }, /every value is undefined/],
    [{ series: Array(7).fill({ fn: 'x' }) }, /At most 6/],
  ];
  for (const [input, re] of cases) assert.throws(() => parsePlot(input), (e) => e instanceof PlotError && re.test(e.message), JSON.stringify(input));
});

test('niceTicks and formatTick', () => {
  assert.deepEqual(niceTicks(0, 50), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(niceTicks(0, 14), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(niceTicks(-1, 1), [-1, -0.5, 0, 0.5, 1]);
  assert.equal(formatTick(0.30000000000000004), '0.3');
  assert.equal(formatTick(250000), '2.5e5');
  assert.equal(formatTick(0.0001), '1.0e-4');
});

// --- inside a reply ---------------------------------------------------------

test('a ```plot block in a reply becomes a figure', () => {
  const md = `Here is the curve:\n\n\`\`\`plot\n${JSON.stringify(SPEC_EXAMPLE, null, 2)}\n\`\`\``;
  const root = renderRich(md, { doc });
  assert.ok(root.querySelector('figure.rich-plot'));
  assert.equal(root.querySelectorAll('pre').length, 0);
});

test('a bad ```plot block shows as code with a "couldn\'t draw this graph" note', () => {
  const root = renderRich('```plot\n{ "series": oops }\n```', { doc });
  const box = root.querySelector('div.rich-plot-error');
  assert.ok(box);
  assert.match(box.querySelector('p.rich-plot-note').textContent, /^Couldn't draw this graph/);
  assert.equal(box.querySelector('code').textContent, '{ "series": oops }');
});
