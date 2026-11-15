// OWNER: Worker 3. Reading settings.appearance safely. Pure functions, unit tested.

import { cleanFamily } from './tokens.js';

export const FONT_LEVELS = Object.freeze(['title', 'ui', 'answer', 'explanation', 'body', 'code']);

/** Bundled fonts (src/renderer/assets/fonts), SIL OFL. */
export const BUNDLED_FONTS = Object.freeze(['VT323', 'JetBrains Mono', 'IBM Plex Sans']);

/** SPEC 9.5.2 defaults, used when contracts aren't reachable (tests) or a level is missing. */
export const DEFAULT_FONTS = Object.freeze({
  title: Object.freeze({ family: 'VT323', size: 22, weight: 400 }),
  ui: Object.freeze({ family: 'JetBrains Mono', size: 12 }),
  answer: Object.freeze({ family: 'JetBrains Mono', size: 17, weight: 700 }),
  explanation: Object.freeze({ family: 'IBM Plex Sans', size: 14 }),
  body: Object.freeze({ family: 'IBM Plex Sans', size: 14 }),
  code: Object.freeze({ family: 'JetBrains Mono', size: 13 }),
});

export const LEVEL_LABELS = Object.freeze({
  title: 'Title bar',
  ui: 'Interface',
  answer: 'Answer',
  explanation: 'Explanation',
  body: 'Chat text',
  code: 'Code',
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** A clean FontChoice for a level. */
export function cleanFont(level, choice) {
  const def = DEFAULT_FONTS[level];
  const c = isObj(choice) ? choice : {};
  const out = {
    family: cleanFamily(c.family) || def.family,
    size: Math.round(num(c.size, 10, 40, def.size)),
  };
  if (level === 'title' || level === 'answer') {
    out.weight = Math.round(num(c.weight, 100, 900, def.weight) / 100) * 100;
  }
  return out;
}

/**
 * A complete, clean appearance object from whatever settings hold.
 * Anything missing or invalid falls back to the defaults.
 */
export function normalizeAppearance(raw) {
  const a = isObj(raw) ? raw : {};
  const fonts = {};
  for (const level of FONT_LEVELS) fonts[level] = cleanFont(level, isObj(a.fonts) ? a.fonts[level] : null);

  const customFonts = [];
  if (Array.isArray(a.customFonts)) {
    for (const f of a.customFonts) {
      if (isObj(f) && typeof f.assetId === 'string' && f.assetId && cleanFamily(f.family)) {
        customFonts.push({ assetId: f.assetId, family: cleanFamily(f.family) });
      }
    }
  }

  let effects = null;
  if (isObj(a.effects)) {
    effects = {
      scanlines: num(a.effects.scanlines, 0, 1, 0),
      glow: num(a.effects.glow, 0, 1, 0),
      vignette: num(a.effects.vignette, 0, 1, 0),
    };
  }

  const bg = isObj(a.background) ? a.background : {};
  return {
    themeId: typeof a.themeId === 'string' && a.themeId ? a.themeId : 'dungeon',
    customThemes: Array.isArray(a.customThemes) ? a.customThemes.slice(0, 50) : [],
    fonts,
    customFonts: customFonts.slice(0, 20),
    effects,
    background: {
      assetId: typeof bg.assetId === 'string' && bg.assetId ? bg.assetId : null,
      fit: ['cover', 'contain', 'auto'].includes(bg.fit) ? bg.fit : 'cover',
      dim: num(bg.dim, 0, 1, 0.6),
      blur: num(bg.blur, 0, 20, 0),
    },
  };
}

/** JSON with sorted keys, to compare two settings objects regardless of key order. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** A family name from an imported font file name: "Press_Start-2P.ttf" -> "Press Start 2P". */
export function familyFromFileName(name) {
  const base = String(name || '').replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/[-_]+/g, ' ');
  return cleanFamily(base) || 'Imported font';
}
