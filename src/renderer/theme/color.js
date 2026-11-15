// OWNER: Worker 3. Small hex color helpers. Pure functions, no DOM, so they run under node --test.

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True for #rgb, #rgba, #rrggbb and #rrggbbaa. */
export function isHexColor(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

/**
 * Normalize to lowercase #rrggbb, or #rrggbbaa when the alpha is not opaque.
 * @returns {string|null} null when the value is not a hex color
 */
export function normalizeHex(value) {
  if (!isHexColor(value)) return null;
  let h = value.trim().slice(1).toLowerCase();
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
  return `#${h}`;
}

/** @returns {{ r: number, g: number, b: number, a: number }} channels 0 to 255, alpha 0 to 1 */
export function parseHex(value) {
  const h = normalizeHex(value);
  if (!h) throw new Error(`not a hex color: ${value}`);
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(1), g: n(3), b: n(5), a: h.length === 9 ? n(7) / 255 : 1 };
}

const to2 = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** @param {{ r: number, g: number, b: number, a?: number }} c */
export function toHex({ r, g, b, a = 1 }) {
  const base = `#${to2(r)}${to2(g)}${to2(b)}`;
  return a >= 1 ? base : base + to2(a * 255);
}

/** Mix two colors: t = 0 gives a, t = 1 gives b. Alpha of a is kept. */
export function mix(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
    a: x.a,
  });
}

/** The same color with a new alpha (0 to 1). */
export function withAlpha(color, alpha) {
  const c = parseHex(color);
  return toHex({ ...c, a: Math.min(1, Math.max(0, alpha)) });
}

/** rgba(...) string, handy inside text-shadow and gradients. */
export function rgba(color, alpha) {
  const c = parseHex(color);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(alpha * 1000) / 1000})`;
}

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque color. */
export function luminance(color) {
  const { r, g, b } = parseHex(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio (1 to 21). A translucent foreground is first blended
 * over the background, the way the screen shows it.
 */
export function contrast(fg, bg) {
  const f = parseHex(fg);
  const shown = f.a < 1 ? mix(toHex({ ...parseHex(bg), a: 1 }), toHex({ ...f, a: 1 }), f.a) : fg;
  const l1 = luminance(shown);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The candidate with the highest contrast against bg. */
export function bestContrast(bg, candidates) {
  let best = candidates[0];
  let bestRatio = -1;
  for (const c of candidates) {
    const r = contrast(c, bg);
    if (r > bestRatio) {
      best = c;
      bestRatio = r;
    }
  }
  return best;
}
