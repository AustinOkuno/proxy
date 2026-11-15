// OWNER: Worker 2. A tiny math expression parser for plot blocks (SPEC 9.7).
// It knows numbers, x, pi, e, + - * / ^, parentheses, implicit multiplication
// (2x, 3(x+1)) and a fixed list of functions. It compiles to closures: there is
// no eval, no Function(), and no way to reach anything that isn't math.

const FUNCS = Object.freeze({
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
});
const CONSTS = Object.freeze({ pi: Math.PI, e: Math.E });

const MAX_LENGTH = 500;
const MAX_DEPTH = 60;

export class ExprError extends Error {}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z]+)|([-+*/^()]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new ExprError(`Unexpected "${src.slice(i).trim()[0]}" at position ${i + 1}`);
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      const name = m[2].toLowerCase();
      if (name === 'x') tokens.push({ t: 'x' });
      else if (Object.hasOwn(CONSTS, name)) tokens.push({ t: 'num', v: CONSTS[name] });
      else if (Object.hasOwn(FUNCS, name)) tokens.push({ t: 'fn', v: name });
      else throw new ExprError(`Unknown name "${m[2]}"`);
    } else tokens.push({ t: m[3] });
    i = re.lastIndex;
  }
  return tokens;
}

/**
 * Compile an expression in x to a function. Throws ExprError for anything
 * that isn't a valid expression.
 * @param {string} source
 * @returns {(x: number) => number}
 */
export function compileExpression(source) {
  if (typeof source !== 'string') throw new ExprError('The expression must be text');
  if (source.length > MAX_LENGTH) throw new ExprError('The expression is too long');
  const tokens = tokenize(source);
  if (!tokens.length) throw new ExprError('The expression is empty');
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const take = (t) => {
    const tok = tokens[pos];
    if (!tok || tok.t !== t) throw new ExprError(`Expected "${t}"`);
    pos += 1;
    return tok;
  };
  const enter = () => {
    depth += 1;
    if (depth > MAX_DEPTH) throw new ExprError('The expression is nested too deeply');
  };

  function primary() {
    const tok = peek();
    if (!tok) throw new ExprError('The expression ends too early');
    if (tok.t === 'num') { pos += 1; const v = tok.v; return () => v; }
    if (tok.t === 'x') { pos += 1; return (x) => x; }
    if (tok.t === 'fn') {
      pos += 1;
      const f = FUNCS[tok.v];
      take('(');
      const arg = expr();
      take(')');
      return (x) => f(arg(x));
    }
    if (tok.t === '(') {
      pos += 1;
      const inner = expr();
      take(')');
      return inner;
    }
    throw new ExprError(`Unexpected "${tok.t}"`);
  }

  function power() {
    const base = primary();
    if (peek() && peek().t === '^') {
      pos += 1;
      enter();
      const exp = unary(); // right-associative: 2^3^2 = 2^(3^2)
      depth -= 1;
      return (x) => base(x) ** exp(x);
    }
    return base;
  }

  function unary() {
    const tok = peek();
    if (tok && (tok.t === '-' || tok.t === '+')) {
      pos += 1;
      enter();
      const inner = unary();
      depth -= 1;
      return tok.t === '-' ? (x) => -inner(x) : inner;
    }
    return power();
  }

  function term() {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok && (tok.t === '*' || tok.t === '/')) {
        pos += 1;
        const right = unary();
        const l = left;
        left = tok.t === '*' ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (tok && (tok.t === 'num' || tok.t === 'x' || tok.t === 'fn' || tok.t === '(')) {
        // Implicit multiplication: 2x, 3(x+1), 2sin(x)
        const right = power();
        const l = left;
        left = (x) => l(x) * right(x);
      } else {
        return left;
      }
    }
  }

  function expr() {
    enter();
    let left = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = take(peek().t).t;
      const right = term();
      const l = left;
      left = op === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    depth -= 1;
    return left;
  }

  const fn = expr();
  if (pos !== tokens.length) throw new ExprError(`Unexpected "${tokens[pos].t}"`);
  return fn;
}
