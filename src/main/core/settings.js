'use strict';

/**
 * Settings store: validated, persisted to dataDir/settings.json. Electron-free.
 */

const path = require('node:path');
const {
  SEND_MODES,
  PANEL_VISIBILITY,
  ANSWER_STYLES,
  PROVIDERS,
  CLAUDE_MODELS,
  PANEL_DOCKS,
  FONT_LEVELS,
  SETTINGS_LIMITS,
  SETTINGS_VERSION,
  LEGACY_HOTKEY_DEFAULTS,
  defaultSettings,
} = require('../../shared/contracts');
const { readJson, writeJsonAtomic, quarantine } = require('./fsutil');

const ENUMS = {
  sendMode: Object.values(SEND_MODES),
  panelVisibility: Object.values(PANEL_VISIBILITY),
  answerStyle: Object.values(ANSWER_STYLES),
  provider: Object.values(PROVIDERS),
  claudeModel: Object.values(CLAUDE_MODELS),
};
// focusPanel is accepted before the lead adds its default (SPEC 9.5.3), so W1 can save it.
const HOTKEY_NAMES = [...new Set([...Object.keys(defaultSettings().hotkeys), 'focusPanel'])];
const MAX_HOTKEY_LENGTH = SETTINGS_LIMITS.acceleratorMaxLength;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, r) => isNum(v) && v >= r.min && v <= r.max;

// ---------------------------------------------------------------------------
// UI phase (settings v3, SPEC 9.5.3)
// ---------------------------------------------------------------------------

const L = SETTINGS_LIMITS;
const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const USER_THEME_ID_RE = /^user-[A-Za-z0-9_-]{1,60}$/;
const COLOR_KEY_RE = /^[a-z0-9-]{1,40}$/;
const MAX_THEME_COLORS = 100;
const MAX_KEYMAP_ENTRIES = 200;
// Colors go straight into CSS custom properties, so only plain color syntax is
// allowed: hex, rgb()/hsl() with numbers, or a bare keyword (named color, none).
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg-]{1,60}\)|[a-zA-Z]{3,30})$/;
// Font families go into font-family; nothing that can end the declaration.
const FAMILY_BAD_RE = /[;{}<>"\\\n\r\t]/;

function cleanString(v, maxLength) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= maxLength ? t : undefined;
}

function cleanFamily(v) {
  const t = cleanString(v, L.fontFamilyMaxLength);
  return t && !FAMILY_BAD_RE.test(t) ? t : undefined;
}

/** Partial FontChoice: each field kept only if valid. */
function cleanFontChoice(v, prefix, dropped) {
  if (!isPlainObject(v)) { dropped.push(prefix); return null; }
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'family' && cleanFamily(val)) out.family = cleanFamily(val);
    else if (k === 'size' && inRange(val, L.fontSize)) out.size = val;
    else if (k === 'weight' && inRange(val, L.fontWeight)) out.weight = Math.round(val);
    else dropped.push(`${prefix}.${k}`);
  }
  return Object.keys(out).length ? out : null;
}

function cleanEffects(v) {
  if (!isPlainObject(v)) return undefined;
  const out = {};
  for (const k of ['scanlines', 'glow', 'vignette']) {
    if (!inRange(v[k], L.effect)) return undefined;
    out[k] = v[k];
  }
  return out;
}

function cleanTheme(t) {
  if (!isPlainObject(t)) return undefined;
  if (typeof t.id !== 'string' || !USER_THEME_ID_RE.test(t.id)) return undefined;
  const name = cleanString(t.name, L.themeNameMaxLength);
  if (!name) return undefined;
  if (t.base !== 'light' && t.base !== 'dark') return undefined;
  if (!isPlainObject(t.colors)) return undefined;
  const colors = {};
  for (const [k, c] of Object.entries(t.colors).slice(0, MAX_THEME_COLORS)) {
    if (COLOR_KEY_RE.test(k) && typeof c === 'string' && COLOR_RE.test(c.trim())) colors[k] = c.trim();
  }
  const effects = cleanEffects(t.effects);
  if (!effects) return undefined;
  if (!inRange(t.radius, L.themeRadius)) return undefined;
  return { id: t.id, name, base: t.base, colors, effects, radius: t.radius };
}

function cleanAppearance(v, dropped) {
  if (!isPlainObject(v)) { dropped.push('appearance'); return null; }
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const p = `appearance.${k}`;
    if (k === 'themeId') {
      if (typeof val === 'string' && ID_RE.test(val)) out.themeId = val;
      else dropped.push(p);
    } else if (k === 'customThemes') {
      if (!Array.isArray(val)) { dropped.push(p); continue; }
      const seen = new Set();
      const themes = [];
      val.forEach((t, i) => {
        const c = cleanTheme(t);
        if (!c || seen.has(c.id) || themes.length >= L.customThemesMax) { dropped.push(`${p}[${i}]`); return; }
        seen.add(c.id);
        themes.push(c);
      });
      out.customThemes = themes;
    } else if (k === 'fonts') {
      if (!isPlainObject(val)) { dropped.push(p); continue; }
      const fonts = {};
      for (const [level, choice] of Object.entries(val)) {
        if (!FONT_LEVELS.includes(level)) { dropped.push(`${p}.${level}`); continue; }
        const c = cleanFontChoice(choice, `${p}.${level}`, dropped);
        if (c) fonts[level] = c;
      }
      if (Object.keys(fonts).length) out.fonts = fonts;
    } else if (k === 'customFonts') {
      if (!Array.isArray(val)) { dropped.push(p); continue; }
      const list = [];
      val.forEach((f, i) => {
        const family = isPlainObject(f) && cleanFamily(f.family);
        const ok = family && typeof f.assetId === 'string' && ID_RE.test(f.assetId) && list.length < L.customFontsMax;
        if (ok) list.push({ assetId: f.assetId, family });
        else dropped.push(`${p}[${i}]`);
      });
      out.customFonts = list;
    } else if (k === 'effects') {
      if (val === null) { out.effects = null; continue; }
      const e = cleanEffects(val);
      if (e) out.effects = e;
      else dropped.push(p);
    } else if (k === 'background') {
      if (!isPlainObject(val)) { dropped.push(p); continue; }
      const bg = {};
      for (const [bk, bv] of Object.entries(val)) {
        if (bk === 'assetId' && (bv === null || (typeof bv === 'string' && ID_RE.test(bv)))) bg.assetId = bv;
        else if (bk === 'fit' && L.backgroundFits.includes(bv)) bg.fit = bv;
        else if (bk === 'dim' && inRange(bv, L.backgroundDim)) bg.dim = bv;
        else if (bk === 'blur' && inRange(bv, L.backgroundBlur)) bg.blur = bv;
        else dropped.push(`${p}.${bk}`);
      }
      if (Object.keys(bg).length) out.background = bg;
    } else {
      dropped.push(p);
    }
  }
  return Object.keys(out).length ? out : null;
}

function cleanPanel(v, dropped) {
  if (!isPlainObject(v)) { dropped.push('panel'); return null; }
  const docks = Object.values(PANEL_DOCKS);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'dock' && docks.includes(val)) out.dock = val;
    else if ((k === 'snap' || k === 'explanationCollapsed') && typeof val === 'boolean') out[k] = val;
    else if (k === 'margin' && inRange(val, L.panelMargin)) out.margin = Math.round(val);
    else dropped.push(`panel.${k}`);
  }
  return Object.keys(out).length ? out : null;
}

/** keymap patch: commandId -> accelerator ('' disables), or null to go back to the default. */
function cleanKeymap(v, dropped) {
  if (!isPlainObject(v)) { dropped.push('keymap'); return null; }
  const out = {};
  for (const [id, accel] of Object.entries(v)) {
    const okId = ID_RE.test(id) && id.length <= 64;
    if (okId && accel === null) out[id] = null;
    else if (okId && typeof accel === 'string' && accel.length <= MAX_HOTKEY_LENGTH) out[id] = accel.trim();
    else dropped.push(`keymap.${id}`);
  }
  return Object.keys(out).length ? out : null;
}

function cleanUsage(v, dropped) {
  if (!isPlainObject(v)) { dropped.push('usage'); return null; }
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'show' && typeof val === 'boolean') out.show = val;
    else if (k === 'geminiDailyRequests' && (val === null || (Number.isInteger(val) && inRange(val, L.geminiDailyRequests)))) {
      out.geminiDailyRequests = val;
    } else dropped.push(`usage.${k}`);
  }
  return Object.keys(out).length ? out : null;
}

const SECTION_CLEANERS = { appearance: cleanAppearance, panel: cleanPanel, keymap: cleanKeymap, usage: cleanUsage };

function cleanBounds(v) {
  if (v === null) return { ok: true, value: null };
  if (!isPlainObject(v)) return { ok: false };
  const out = {};
  for (const k of ['x', 'y', 'width', 'height']) {
    if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) return { ok: false };
    out[k] = Math.round(v[k]);
  }
  if (out.width <= 0 || out.height <= 0) return { ok: false };
  return { ok: true, value: out };
}

/**
 * Turn an untrusted patch into a clean one. Unknown keys and invalid values are
 * dropped (with a note in `dropped`), never thrown.
 * @param {any} patch
 * @returns {{ clean: import('../../shared/contracts').SettingsPatch, dropped: string[] }}
 */
function sanitizePatch(patch) {
  const clean = {};
  const dropped = [];
  if (!isPlainObject(patch)) return { clean, dropped: patch == null ? [] : ['(not an object)'] };

  for (const [key, value] of Object.entries(patch)) {
    if (key in ENUMS) {
      if (ENUMS[key].includes(value)) clean[key] = value;
      else dropped.push(key);
    } else if (key === 'hotkeys') {
      if (!isPlainObject(value)) { dropped.push(key); continue; }
      const hk = {};
      for (const [name, accel] of Object.entries(value)) {
        if (HOTKEY_NAMES.includes(name) && typeof accel === 'string' && accel.length <= MAX_HOTKEY_LENGTH) {
          hk[name] = accel.trim();
        } else {
          dropped.push(`hotkeys.${name}`);
        }
      }
      if (Object.keys(hk).length) clean.hotkeys = hk;
    } else if (key === 'panelBounds') {
      const b = cleanBounds(value);
      if (b.ok) clean.panelBounds = b.value;
      else dropped.push(key);
    } else if (key in SECTION_CLEANERS) {
      const c = SECTION_CLEANERS[key](value, dropped);
      if (c) clean[key] = c;
    } else if (key === 'version') {
      // Managed by the store; silently ignored in patches.
    } else {
      dropped.push(key);
    }
  }
  return { clean, dropped };
}

function mergeAppearance(base, patch) {
  if (!patch) return base;
  const fonts = { ...base.fonts };
  for (const [level, choice] of Object.entries(patch.fonts || {})) fonts[level] = { ...fonts[level], ...choice };
  return {
    ...base,
    ...patch,
    fonts,
    background: { ...base.background, ...(patch.background || {}) },
  };
}

function mergeKeymap(base, patch) {
  const out = { ...base };
  for (const [id, accel] of Object.entries(patch || {})) {
    if (accel === null) delete out[id];
    else out[id] = accel;
  }
  // Keep the stored map bounded even if a client keeps adding ids.
  return Object.fromEntries(Object.entries(out).slice(-MAX_KEYMAP_ENTRIES));
}

/**
 * Apply a clean patch to settings. hotkeys, panel and usage merge per key;
 * appearance one level deep with fonts per level and background per field;
 * keymap per key (null removes an override); arrays are replaced whole.
 * Returns a new object.
 */
function mergeSettings(base, clean) {
  return {
    ...base,
    ...clean,
    hotkeys: { ...base.hotkeys, ...(clean.hotkeys || {}) },
    appearance: mergeAppearance(base.appearance, clean.appearance),
    panel: { ...base.panel, ...(clean.panel || {}) },
    keymap: mergeKeymap(base.keymap, clean.keymap),
    usage: { ...base.usage, ...(clean.usage || {}) },
    version: SETTINGS_VERSION,
  };
}

/**
 * Bring a settings file from an older version up to date. v1 -> v2: hotkeys
 * still on the old Super+Shift defaults move to the new defaults; hotkeys the
 * user changed are kept. v2 -> v3 needs no rewrite: the new UI-phase keys are
 * filled in from the defaults by the merge. Returns the hotkey names that were moved.
 * @param {any} raw  parsed settings.json (mutated)
 * @returns {string[]}
 */
function migrateSettings(raw) {
  const moved = [];
  if (!isPlainObject(raw)) return moved;
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version < 2 && isPlainObject(raw.hotkeys)) {
    const defaults = defaultSettings().hotkeys;
    for (const [name, old] of Object.entries(LEGACY_HOTKEY_DEFAULTS)) {
      const cur = raw.hotkeys[name];
      if (typeof cur === 'string' && cur.replace(/\s+/g, '').toLowerCase() === old.toLowerCase()) {
        raw.hotkeys[name] = defaults[name];
        moved.push(name);
      }
    }
  }
  return moved;
}

const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * @param {{ dataDir: string, logger?: Pick<Console,'warn'> }} opts
 */
function createSettingsStore({ dataDir, logger = console }) {
  const file = path.join(dataDir, 'settings.json');
  let current = defaultSettings();

  const loaded = readJson(file);
  let migrated = false;
  if (loaded.ok) {
    const moved = migrateSettings(loaded.value);
    const { clean, dropped } = sanitizePatch(loaded.value);
    current = mergeSettings(current, clean);
    if (dropped.length) logger.warn(`[core] settings.json: ignored invalid entries: ${dropped.join(', ')}`);
    if (moved.length) {
      logger.warn(`[core] settings.json: moved old Super+Shift hotkeys to new defaults: ${moved.join(', ')}`);
    }
    migrated = loaded.value && loaded.value.version !== SETTINGS_VERSION;
  } else if (!loaded.missing) {
    logger.warn(`[core] settings.json unreadable, using defaults: ${loaded.error && loaded.error.message}`);
    quarantine(file);
  }

  const listeners = new Set();

  function persist() {
    try {
      writeJsonAtomic(file, current);
    } catch (err) {
      logger.warn(`[core] could not save settings: ${err.message}`);
    }
  }

  if (migrated) persist();

  return {
    get: () => copy(current),
    /** @param {import('../../shared/contracts').SettingsPatch} patch */
    update(patch) {
      const { clean, dropped } = sanitizePatch(patch);
      if (dropped.length) logger.warn(`[core] settings.update: dropped invalid entries: ${dropped.join(', ')}`);
      const next = mergeSettings(current, clean);
      const changed = JSON.stringify(next) !== JSON.stringify(current);
      current = next;
      if (changed) {
        persist();
        for (const cb of [...listeners]) {
          try {
            cb(copy(current));
          } catch (err) {
            logger.warn(`[core] settings listener failed: ${err.message}`);
          }
        }
      }
      return copy(current);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

module.exports = { createSettingsStore, sanitizePatch, mergeSettings, migrateSettings };
