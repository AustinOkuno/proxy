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
  SETTINGS_VERSION,
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
const HOTKEY_NAMES = Object.keys(defaultSettings().hotkeys);
const MAX_HOTKEY_LENGTH = 100;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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
    } else if (key === 'version') {
      // Managed by the store; silently ignored in patches.
    } else {
      dropped.push(key);
    }
  }
  return { clean, dropped };
}

/** Apply a clean patch to settings, deep-merging hotkeys. Returns a new object. */
function mergeSettings(base, clean) {
  return {
    ...base,
    ...clean,
    hotkeys: { ...base.hotkeys, ...(clean.hotkeys || {}) },
    version: SETTINGS_VERSION,
  };
}

const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * @param {{ dataDir: string, logger?: Pick<Console,'warn'> }} opts
 */
function createSettingsStore({ dataDir, logger = console }) {
  const file = path.join(dataDir, 'settings.json');
  let current = defaultSettings();

  const loaded = readJson(file);
  if (loaded.ok) {
    const { clean, dropped } = sanitizePatch(loaded.value);
    current = mergeSettings(current, clean);
    if (dropped.length) logger.warn(`[core] settings.json: ignored invalid entries: ${dropped.join(', ')}`);
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

module.exports = { createSettingsStore, sanitizePatch, mergeSettings };
