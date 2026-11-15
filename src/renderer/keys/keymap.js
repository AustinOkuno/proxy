// OWNER: Worker 1 (UI phase). The keymap: default shortcuts (SPEC 9.6), the
// user's overrides from settings.keymap, and turning key presses into command
// ids. Pure, no DOM, so it runs under node --test.

import { validateAccelerator, keyEventToAccelerator } from '../lib/accelerator.js';

/** Default in-panel shortcuts, commandId -> accelerator (SPEC 9.6). */
export const DEFAULT_KEYMAP = Object.freeze({
  'app.commandBar': 'Ctrl+K',
  'chat.new': 'Ctrl+N',
  'chat.next': 'Ctrl+Tab',
  'chat.prev': 'Ctrl+Shift+Tab',
  'chat.switch': 'Ctrl+P',
  'chat.copyAnswer': 'Ctrl+Shift+C',
  'reply.toggleExplanation': 'Ctrl+E',
  'history.search': 'Ctrl+F',
  'history.pinCurrent': 'Ctrl+Shift+P',
  'app.toggleSidebar': 'Ctrl+B',
  'panel.dock.top-left': 'Alt+1',
  'panel.dock.top-right': 'Alt+2',
  'panel.dock.bottom-left': 'Alt+3',
  'panel.dock.bottom-right': 'Alt+4',
  'app.settings': 'Ctrl+,',
  'theme.next': 'Ctrl+T',
});

/** Keys the panel always handles itself; they can't be bound to commands. */
const RESERVED = new Set(['Escape', 'Enter', 'Shift+Enter', 'Tab', 'Shift+Tab']);

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];
const MOD_ALIAS = {
  ctrl: 'Ctrl', control: 'Ctrl', cmd: 'Ctrl', command: 'Ctrl', cmdorctrl: 'Ctrl', commandorcontrol: 'Ctrl',
  alt: 'Alt', option: 'Alt', altgr: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super',
};
const KEY_ALIAS = { Return: 'Enter', Esc: 'Escape' };

/**
 * One spelling per shortcut, so "control+shift+c", "Shift+Ctrl+C" and
 * "CmdOrCtrl+Shift+c" all compare equal. Returns '' for empty or invalid input.
 * @param {string} acc
 * @returns {string}
 */
export function normalizeAccelerator(acc) {
  const v = validateAccelerator(acc);
  if (!v.ok || !v.value) return '';
  const parts = v.value.split('+');
  // validateAccelerator turns a trailing "++" into "Plus", so the last part is the key.
  const key = parts.pop();
  const mods = new Set(parts.map((m) => MOD_ALIAS[m.toLowerCase()]).filter(Boolean));
  return [...MOD_ORDER.filter((m) => mods.has(m)), KEY_ALIAS[key] || key].join('+');
}

/**
 * The shortcut a keydown event stands for, normalized, or '' while only
 * modifiers are held.
 * @param {{ code: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean }} ev
 */
export function eventAccelerator(ev) {
  const acc = keyEventToAccelerator(ev);
  return acc ? normalizeAccelerator(acc) : '';
}

/** True if the shortcut can't be bound (Esc, Enter, Tab are fixed). */
export function isReserved(acc) {
  return RESERVED.has(normalizeAccelerator(acc));
}

/**
 * True if the shortcut has Ctrl, Alt or Super, or is a function key, so it is
 * safe to catch while the user is typing in a text box.
 */
export function worksWhileTyping(acc) {
  const parts = normalizeAccelerator(acc).split('+');
  const key = parts[parts.length - 1];
  return parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Super') || /^F\d{1,2}$/.test(key);
}

/**
 * The keymap in effect: defaults with the user's overrides on top. An override
 * of '' turns a shortcut off; invalid or reserved overrides are ignored (the
 * default stays). Overrides may name commands that have no default.
 * @param {Record<string,string>} [overrides]  settings.keymap
 * @returns {Record<string,string>} commandId -> normalized accelerator ('' = none)
 */
export function resolveKeymap(overrides) {
  const out = {};
  for (const [id, acc] of Object.entries(DEFAULT_KEYMAP)) out[id] = normalizeAccelerator(acc);
  for (const [id, acc] of Object.entries(overrides || {})) {
    if (typeof acc !== 'string') continue;
    if (acc.trim() === '') {
      out[id] = '';
      continue;
    }
    const norm = normalizeAccelerator(acc);
    if (norm && !RESERVED.has(norm)) out[id] = norm;
  }
  return out;
}

/**
 * Shortcut -> command ids, for looking up key presses. A shortcut bound to
 * several commands lists them all; the first one that is available runs.
 * @param {Record<string,string>} keymap  from resolveKeymap
 * @returns {Map<string, string[]>}
 */
export function buildLookup(keymap) {
  const map = new Map();
  for (const [id, acc] of Object.entries(keymap)) {
    if (!acc) continue;
    if (!map.has(acc)) map.set(acc, []);
    map.get(acc).push(id);
  }
  return map;
}

/**
 * Groups of command ids that share a shortcut (for the Keys tab's warning).
 * @param {Record<string,string>} keymap
 * @returns {string[][]}
 */
export function findConflicts(keymap) {
  return [...buildLookup(keymap).values()].filter((ids) => ids.length > 1);
}
