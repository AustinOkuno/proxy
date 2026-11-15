'use strict';

/**
 * Global hotkey registration (no direct Electron import, so it can be tested
 * with a fake globalShortcut).
 */

const HOTKEY_NAMES = Object.freeze(['regionSnip', 'fullScreenshot', 'togglePanel', 'focusPanel']);

/**
 * Defaults the shell uses for hotkeys that settings don't have yet. The lead
 * adds focusPanel to DEFAULT_SETTINGS with this PR (SPEC 9.5.3); until then a
 * missing (undefined) focusPanel means this. An empty string still disables it.
 */
const FALLBACK_HOTKEYS = Object.freeze({ focusPanel: 'Ctrl+Alt+Space' });

/** Fill hotkeys that are missing from settings with FALLBACK_HOTKEYS. */
function withFallbacks(hotkeys) {
  const out = { ...(hotkeys || {}) };
  for (const [name, acc] of Object.entries(FALLBACK_HOTKEYS)) {
    if (out[name] === undefined || out[name] === null) out[name] = acc;
  }
  return out;
}

const LABELS = Object.freeze({
  regionSnip: 'Region snip',
  fullScreenshot: 'Full screenshot',
  togglePanel: 'Show/hide panel',
  focusPanel: 'Focus panel',
});

const MODIFIERS = new Set([
  'command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl', 'alt', 'option',
  'altgr', 'shift', 'super', 'meta',
]);

const KEYS = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
  ')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '+', '=', '<', ',', '_', '-',
  '>', '.', '?', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"', "'",
  'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace', 'delete',
  'insert', 'return', 'enter', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup',
  'pagedown', 'escape', 'esc', 'volumeup', 'volumedown', 'volumemute', 'medianexttrack',
  'mediaprevioustrack', 'mediastop', 'mediaplaypause', 'printscreen',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
]);

/**
 * Check an Electron accelerator string. Empty means "disabled" and is valid.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateAccelerator(acc) {
  if (acc === '' || acc == null) return { ok: true };
  if (typeof acc !== 'string') return { ok: false, reason: 'not a string' };
  const parts = acc.split('+');
  // "Ctrl++" style: a trailing empty part after '+' means the Plus key.
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(parts.length - 2, 2, '+');
  }
  if (parts.some((p) => p.trim() === '')) return { ok: false, reason: 'empty part' };
  const key = parts[parts.length - 1].trim().toLowerCase();
  const mods = parts.slice(0, -1).map((p) => p.trim().toLowerCase());
  for (const m of mods) {
    if (!MODIFIERS.has(m)) return { ok: false, reason: `unknown modifier "${m}"` };
  }
  if (MODIFIERS.has(key)) return { ok: false, reason: 'needs a key after the modifiers' };
  if (!KEYS.has(key)) return { ok: false, reason: `unknown key "${parts[parts.length - 1]}"` };
  return { ok: true };
}

/**
 * @param {{
 *   globalShortcut: { register(acc: string, cb: Function): boolean, unregister(acc: string): void },
 *   handlers: { regionSnip: Function, fullScreenshot: Function, togglePanel: Function, focusPanel?: Function },
 *   onError: (message: string) => void,
 *   log?: { warn: Function },
 * }} deps
 */
function createHotkeyManager({ globalShortcut, handlers, onError, log = console }) {
  /** name -> accelerator currently registered by us */
  const registered = new Map();
  let lastConfig = null;

  function unregisterAll() {
    for (const acc of registered.values()) {
      try {
        globalShortcut.unregister(acc);
      } catch {
        /* ignore */
      }
    }
    registered.clear();
  }

  /**
   * Register the given hotkeys, replacing any previous set. Returns per-name
   * results so callers/tests can inspect them.
   * @param {Record<string,string>} hotkeys
   */
  function apply(hotkeys) {
    const config = {};
    for (const name of HOTKEY_NAMES) config[name] = (hotkeys && hotkeys[name]) || '';
    if (lastConfig && HOTKEY_NAMES.every((n) => lastConfig[n] === config[n])) {
      return null; // nothing changed
    }
    lastConfig = config;
    unregisterAll();

    const results = {};
    const failures = [];
    const seen = new Map();
    for (const name of HOTKEY_NAMES) {
      const acc = config[name];
      if (!acc) {
        results[name] = 'disabled';
        continue;
      }
      const v = validateAccelerator(acc);
      if (!v.ok) {
        results[name] = 'invalid';
        failures.push(`${LABELS[name]} hotkey "${acc}" is not valid (${v.reason}).`);
        continue;
      }
      const norm = acc.toLowerCase().replace(/\s+/g, '');
      if (seen.has(norm)) {
        results[name] = 'duplicate';
        failures.push(`${LABELS[name]} hotkey "${acc}" is already used for ${LABELS[seen.get(norm)]}.`);
        continue;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(acc, () => {
          if (handlers[name]) handlers[name]();
        });
      } catch (err) {
        log.warn(`[shell] register ${acc} threw: ${err.message}`);
        ok = false;
      }
      if (ok) {
        registered.set(name, acc);
        seen.set(norm, name);
        results[name] = 'ok';
      } else {
        results[name] = 'failed';
        failures.push(
          `Couldn't register the ${LABELS[name]} hotkey "${acc}". Another app or Cinnamon ` +
            'probably uses it. Pick a different key in Settings, or free it in ' +
            'System Settings > Keyboard > Shortcuts.',
        );
      }
    }
    for (const msg of failures) {
      log.warn(`[shell] ${msg}`);
      onError(msg);
    }
    return results;
  }

  function dispose() {
    unregisterAll();
    lastConfig = null;
  }

  return { apply, dispose, registered };
}

module.exports = { createHotkeyManager, validateAccelerator, withFallbacks, HOTKEY_NAMES, FALLBACK_HOTKEYS };
