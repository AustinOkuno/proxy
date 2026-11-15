// OWNER: Worker 3. The theme token set (SPEC 9.5.1) and how a ThemeDef becomes CSS variables.
// Pure functions: no DOM, so the engine's math is unit tested with node --test.

import { bestContrast, mix, normalizeHex, rgba, withAlpha } from './color.js';

/** Every color token a theme resolves to (names without the leading '--'). */
export const COLOR_TOKENS = Object.freeze([
  // Colors
  'bg', 'surface', 'surface-2', 'surface-hover', 'border', 'text', 'text-muted',
  'accent', 'accent-2', 'accent-text', 'danger', 'danger-bg', 'warning', 'success',
  'focus-ring', 'selection-bg', 'overlay-shadow', 'drop-target-bg', 'drop-target-border',
  // Answer ('answer-glow' is the glow's color here; the CSS variable --answer-glow is a text-shadow)
  'answer-bg', 'answer-text', 'answer-border', 'answer-glow',
  // Bubbles
  'bubble-user-bg', 'bubble-user-text', 'bubble-assistant-bg', 'bubble-assistant-text',
  'bubble-error-bg', 'bubble-error-text',
  // Code and math
  'code-bg', 'code-text', 'code-keyword', 'code-string', 'code-number', 'code-comment',
  'code-function', 'math-text',
  // Plots
  'plot-axis', 'plot-grid', 'plot-1', 'plot-2', 'plot-3', 'plot-4',
]);

/** The few colors a theme really needs; everything else is derived from them. */
export const CORE_TOKENS = Object.freeze(['bg', 'surface', 'text', 'text-muted', 'accent', 'accent-2']);

/** Grouping for the theme editor. */
export const TOKEN_GROUPS = Object.freeze([
  { label: 'Main', tokens: CORE_TOKENS },
  { label: 'Interface', tokens: ['surface-2', 'surface-hover', 'border', 'accent-text', 'danger', 'danger-bg', 'warning', 'success', 'focus-ring', 'selection-bg', 'overlay-shadow', 'drop-target-bg', 'drop-target-border'] },
  { label: 'Answer', tokens: ['answer-bg', 'answer-text', 'answer-border', 'answer-glow'] },
  { label: 'Bubbles', tokens: ['bubble-user-bg', 'bubble-user-text', 'bubble-assistant-bg', 'bubble-assistant-text', 'bubble-error-bg', 'bubble-error-text'] },
  { label: 'Code and math', tokens: ['code-bg', 'code-text', 'code-keyword', 'code-string', 'code-number', 'code-comment', 'code-function', 'math-text'] },
  { label: 'Graphs', tokens: ['plot-axis', 'plot-grid', 'plot-1', 'plot-2', 'plot-3', 'plot-4'] },
]);

/** Core colors used when a theme leaves one out, per base. */
export const BASE_CORE = Object.freeze({
  light: Object.freeze({ bg: '#e8dfd2', surface: '#f2ebe1', text: '#3a2e28', 'text-muted': '#75665a', accent: '#8e1b2a', 'accent-2': '#b08d57' }),
  dark: Object.freeze({ bg: '#070b1a', surface: '#0e1530', text: '#d6e6ff', 'text-muted': '#8595bd', accent: '#3ee6ff', 'accent-2': '#7a5cff' }),
});

const STATUS = Object.freeze({
  light: { danger: '#a3202c', warning: '#7d5300', success: '#2c6b34' },
  dark: { danger: '#ff6b7a', warning: '#f2c46b', success: '#5fd38d' },
});

/**
 * Fill in every color token for a theme. Explicit colors win; the rest are
 * derived from the core colors so a user theme with six colors still looks whole.
 * @param {{ base?: 'light'|'dark', colors?: Object<string,string> }} theme
 * @returns {Object<string,string>} every COLOR_TOKENS key -> normalized hex
 */
export function resolveColors(theme) {
  const base = theme && theme.base === 'light' ? 'light' : 'dark';
  const given = {};
  for (const [k, v] of Object.entries((theme && theme.colors) || {})) {
    const hex = normalizeHex(v);
    if (hex && COLOR_TOKENS.includes(k)) given[k] = hex;
  }
  const c = {};
  const pick = (name, derive) => {
    c[name] = given[name] || derive();
  };
  for (const name of CORE_TOKENS) pick(name, () => BASE_CORE[base][name]);

  const light = base === 'light';
  const status = STATUS[base];
  pick('surface-2', () => mix(c.surface, c.text, 0.07));
  pick('surface-hover', () => mix(c.surface, c.text, 0.13));
  pick('border', () => mix(c.surface, c.text, light ? 0.2 : 0.18));
  pick('accent-text', () => bestContrast(c.accent, [c.bg, c.text, '#000000', '#ffffff']));
  pick('danger', () => status.danger);
  pick('danger-bg', () => mix(c.bg, c.danger, 0.14));
  pick('warning', () => status.warning);
  pick('success', () => status.success);
  pick('focus-ring', () => withAlpha(c.accent, 0.6));
  pick('selection-bg', () => withAlpha(c.accent, light ? 0.22 : 0.3));
  pick('overlay-shadow', () => (light ? withAlpha(c.text, 0.28) : '#000000a6'));
  pick('drop-target-bg', () => withAlpha(c.accent, 0.15));
  pick('drop-target-border', () => c.accent);

  pick('answer-bg', () => mix(c.surface, c.accent, light ? 0.06 : 0.1));
  pick('answer-text', () => c.text);
  pick('answer-border', () => c.accent);
  pick('answer-glow', () => c.accent);

  pick('bubble-user-bg', () => mix(c.surface, c['accent-2'], light ? 0.16 : 0.2));
  pick('bubble-user-text', () => c.text);
  pick('bubble-assistant-bg', () => c.surface);
  pick('bubble-assistant-text', () => c.text);
  pick('bubble-error-bg', () => c['danger-bg']);
  pick('bubble-error-text', () => c.danger);

  pick('code-bg', () => mix(c.bg, light ? c.text : '#000000', light ? 0.05 : 0.25));
  pick('code-text', () => c.text);
  pick('code-keyword', () => c.accent);
  pick('code-string', () => c['accent-2']);
  pick('code-number', () => c.warning);
  pick('code-comment', () => c['text-muted']);
  pick('code-function', () => mix(c.accent, c.text, 0.35));
  pick('math-text', () => c.text);

  pick('plot-axis', () => c['text-muted']);
  pick('plot-grid', () => mix(c.bg, c.text, 0.12));
  pick('plot-1', () => c.accent);
  pick('plot-2', () => c['accent-2']);
  pick('plot-3', () => c.warning);
  pick('plot-4', () => c.success);
  return c;
}

const clamp01 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** The text-shadow for a glow strength (0 = none). */
export function glowShadow(color, strength, { spread = 1 } = {}) {
  const g = clamp01(strength);
  if (g === 0) return 'none';
  const blur = Math.round((2 + 8 * g) * spread * 10) / 10;
  return `0 0 ${blur}px ${rgba(color, 0.25 + 0.5 * g)}`;
}

/** Font fallbacks per level, so a missing font still looks right. */
const MONO_FALLBACK = '"JetBrains Mono", "DejaVu Sans Mono", ui-monospace, monospace';
const SANS_FALLBACK = '"IBM Plex Sans", "Ubuntu", system-ui, sans-serif';
export const LEVEL_FALLBACK = Object.freeze({
  title: `"VT323", ${MONO_FALLBACK}`,
  ui: MONO_FALLBACK,
  answer: MONO_FALLBACK,
  explanation: SANS_FALLBACK,
  body: SANS_FALLBACK,
  code: MONO_FALLBACK,
});

/** Keep only characters that are safe inside a quoted CSS font-family name. */
export function cleanFamily(family) {
  if (typeof family !== 'string') return '';
  return family.replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** CSS font-family value for a level: the chosen family first, then the fallbacks. */
export function fontStack(level, family) {
  const name = cleanFamily(family);
  const fallback = LEVEL_FALLBACK[level] || MONO_FALLBACK;
  if (!name) return fallback;
  const rest = fallback.split(', ').filter((f) => f.toLowerCase() !== `"${name.toLowerCase()}"`);
  return [`"${name}"`, ...rest].join(', ');
}

/**
 * Every CSS variable the engine sets, as a plain map ('--bg' -> '#070b1a').
 * @param {{ theme: object, fonts?: object, effects?: object|null, background?: object, bgImageUrl?: string|null, defaults?: object }} input
 *   `fonts` per level ({ family, size, weight? }); `effects` overrides the theme's when not null;
 *   `bgImageUrl` is a data: URL already loaded from assets, or null.
 */
export function buildVariables({ theme, fonts = {}, effects = null, background = {}, bgImageUrl = null, defaults = {} }) {
  const vars = {};
  const colors = resolveColors(theme);
  for (const name of COLOR_TOKENS) {
    if (name !== 'answer-glow') vars[`--${name}`] = colors[name];
  }

  const fx = { scanlines: 0, glow: 0, vignette: 0, ...(theme && theme.effects), ...(effects || {}) };
  vars['--glow'] = glowShadow(colors.text, fx.glow * 0.6);
  vars['--answer-glow'] = glowShadow(colors['answer-glow'], fx.glow, { spread: 1.3 });
  vars['--scanline-opacity'] = String(clamp01(fx.scanlines));
  vars['--vignette-opacity'] = String(clamp01(fx.vignette));
  vars['--scanline-color'] = theme && theme.base === 'light' ? rgba(colors.text, 0.16) : 'rgba(0, 0, 0, 0.45)';
  vars['--vignette-color'] = theme && theme.base === 'light' ? rgba(colors.text, 0.35) : 'rgba(0, 0, 0, 0.75)';

  const radius = typeof theme?.radius === 'number' ? Math.min(12, Math.max(0, Math.round(theme.radius))) : 4;
  vars['--radius'] = `${radius}px`;
  vars['--radius-small'] = `${Math.max(0, Math.round(radius / 2))}px`;

  const fits = ['cover', 'contain', 'auto'];
  vars['--bg-image'] = bgImageUrl ? `url("${bgImageUrl.replace(/["\\\n]/g, '')}")` : 'none';
  vars['--bg-dim'] = String(clamp01(background.dim ?? 0.6));
  vars['--bg-blur'] = `${Math.min(20, Math.max(0, Number(background.blur) || 0))}px`;
  vars['--bg-fit'] = fits.includes(background.fit) ? background.fit : 'cover';

  for (const level of Object.keys(LEVEL_FALLBACK)) {
    const choice = { ...(defaults[level] || {}), ...(fonts[level] || {}) };
    vars[`--font-${level}`] = fontStack(level, choice.family);
    const size = Number(choice.size);
    vars[`--size-${level}`] = `${Number.isFinite(size) ? Math.min(40, Math.max(10, Math.round(size))) : 14}px`;
    if (level === 'title' || level === 'answer') {
      const w = Number(choice.weight);
      vars[`--weight-${level}`] = String(Number.isFinite(w) ? Math.min(900, Math.max(100, Math.round(w / 100) * 100)) : 400);
    }
  }
  return vars;
}
