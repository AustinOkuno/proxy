// OWNER: Worker 3. Built-in themes (SPEC 9.4) and user theme validation.
// Colors come from Austin's reference screenshots; a few shades are tuned so
// body text stays at 4.5:1 or better (test/renderer/theme checks it).

import { normalizeHex } from './color.js';
import { COLOR_TOKENS } from './tokens.js';

export const DEFAULT_THEME_ID = 'dungeon';

const freeze = (t) => Object.freeze({ ...t, colors: Object.freeze(t.colors), effects: Object.freeze(t.effects) });

export const BUILTIN_THEMES = Object.freeze([
  freeze({
    id: 'dungeon',
    name: 'Dungeon',
    base: 'light',
    // Warm cream paper, sepia ink, crimson: the Type Dungeon page.
    colors: {
      bg: '#e8dfd2',
      surface: '#f2ebe1',
      text: '#3a2e28',
      'text-muted': '#75665a',
      accent: '#8e1b2a',
      'accent-2': '#b08d57',
      'accent-text': '#f7f1e8',
      border: '#d3c6b4',
      'answer-bg': '#f7f1e8',
      'answer-text': '#2e231e',
      'bubble-user-bg': '#e6d8c2',
      'code-bg': '#ece3d6',
      'code-string': '#6e4f1f',
      'code-number': '#8a4b12',
      'code-function': '#5a3a6e',
      'plot-2': '#9a7440',
    },
    effects: { scanlines: 0.35, glow: 0, vignette: 0.15 },
    radius: 4,
  }),
  freeze({
    id: 'neon-night',
    name: 'Neon Night',
    base: 'dark',
    // Headphones and a night city: deep navy, cyan glow, violet.
    colors: {
      bg: '#070b1a',
      surface: '#0e1530',
      text: '#d6e6ff',
      'text-muted': '#8595bd',
      accent: '#3ee6ff',
      'accent-2': '#7a5cff',
      border: '#1f2d55',
      'answer-bg': '#0b1a36',
      'answer-text': '#e9f6ff',
      'code-string': '#b8a6ff',
    },
    effects: { scanlines: 0.6, glow: 0.7, vignette: 0.45 },
    radius: 2,
  }),
  freeze({
    id: 'fallen-angel',
    name: 'Fallen Angel',
    base: 'dark',
    // Black and silver with icy teal streaks, high contrast.
    colors: {
      bg: '#050506',
      surface: '#121214',
      text: '#ececf0',
      'text-muted': '#8f929b',
      accent: '#c9ced6',
      'accent-2': '#4fb3c8',
      border: '#2a2b30',
      'answer-bg': '#16181b',
      'answer-text': '#ffffff',
      'answer-glow': '#ffffff',
      'answer-border': '#4fb3c8',
    },
    effects: { scanlines: 0, glow: 0.45, vignette: 0.35 },
    radius: 0,
  }),
  freeze({
    id: 'studio',
    name: 'Studio',
    base: 'dark',
    // A music studio console: dark teal with pink.
    colors: {
      bg: '#0b1e24',
      surface: '#10303a',
      text: '#cdf3f0',
      'text-muted': '#7fb0b3',
      accent: '#ff5fa2',
      'accent-2': '#39c5bb',
      border: '#1d4a55',
      'answer-bg': '#13323d',
      'code-bg': '#071519',
    },
    effects: { scanlines: 0.35, glow: 0.55, vignette: 0.3 },
    radius: 3,
  }),
]);

const clamp = (n, lo, hi, fallback) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** A fresh user theme id. */
export function newThemeId() {
  return `user-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Clean an untrusted theme (an imported file or a stored one). Unknown keys and
 * bad colors are dropped; a theme without a usable name or base is rejected.
 * @param {any} raw
 * @param {{ keepId?: boolean }} [opts]  keepId: keep a valid 'user-…' id (stored themes); imports get a new id
 * @returns {{ ok: true, theme: object } | { ok: false, error: string }}
 */
export function validateTheme(raw, { keepId = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'A theme must be a JSON object.' };
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  if (!name) return { ok: false, error: 'The theme needs a name.' };
  const base = raw.base === 'light' || raw.base === 'dark' ? raw.base : null;
  if (!base) return { ok: false, error: 'The theme\'s base must be "light" or "dark".' };

  const colors = {};
  if (raw.colors && typeof raw.colors === 'object') {
    for (const [k, v] of Object.entries(raw.colors)) {
      const hex = COLOR_TOKENS.includes(k) ? normalizeHex(v) : null;
      if (hex) colors[k] = hex;
    }
  }
  const fx = raw.effects && typeof raw.effects === 'object' ? raw.effects : {};
  const id = keepId && typeof raw.id === 'string' && /^user-[a-z0-9]{1,32}$/.test(raw.id) ? raw.id : newThemeId();
  return {
    ok: true,
    theme: {
      id,
      name,
      base,
      colors,
      effects: {
        scanlines: clamp(fx.scanlines, 0, 1, 0),
        glow: clamp(fx.glow, 0, 1, 0),
        vignette: clamp(fx.vignette, 0, 1, 0),
      },
      radius: Math.round(clamp(raw.radius, 0, 12, 4)),
    },
  };
}

/** Built-ins followed by the user's valid themes. */
export function allThemes(settings) {
  const custom = settings?.appearance?.customThemes;
  const users = [];
  if (Array.isArray(custom)) {
    for (const t of custom) {
      const v = validateTheme(t, { keepId: true });
      if (v.ok && !users.some((u) => u.id === v.theme.id)) users.push(v.theme);
    }
  }
  return [...BUILTIN_THEMES, ...users];
}

/** The theme for an id, falling back to Dungeon. */
export function findTheme(settings, id) {
  return allThemes(settings).find((t) => t.id === id) || BUILTIN_THEMES[0];
}

export function isBuiltin(id) {
  return BUILTIN_THEMES.some((t) => t.id === id);
}

/** A copy of a theme, as a new user theme with "copy" in the name. */
export function duplicateTheme(theme, existingNames = []) {
  let name = `${theme.name} copy`.slice(0, 40);
  for (let i = 2; existingNames.includes(name); i += 1) name = `${theme.name} copy ${i}`.slice(0, 40);
  return {
    id: newThemeId(),
    name,
    base: theme.base,
    colors: { ...theme.colors },
    effects: { ...theme.effects },
    radius: theme.radius,
  };
}

/** The JSON a user exports (no id: an import always gets a fresh one). */
export function exportTheme(theme) {
  const { name, base, colors, effects, radius } = theme;
  return JSON.stringify({ proxyTheme: 1, name, base, colors, effects, radius }, null, 2);
}

/** Parse an exported theme file. */
export function importTheme(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn\'t valid JSON.' };
  }
  return validateTheme(raw);
}
