// OWNER: Worker 1 (UI phase). The data behind Settings > Keys (SPEC 9.6):
// one row per command with its shortcut and any clash, and the keymap patch a
// change makes. Pure, no DOM, so it runs under node --test.

import { DEFAULT_KEYMAP, normalizeAccelerator, resolveKeymap, isReserved, worksWhileTyping } from './keymap.js';

/** Titles for commands that have a default key but aren't registered yet. */
const FALLBACK_TITLES = {
  'app.commandBar': 'Open the command bar',
  'chat.new': 'New chat',
  'chat.next': 'Next chat',
  'chat.prev': 'Previous chat',
  'chat.switch': 'Switch to a chat by name',
  'chat.copyAnswer': 'Copy the latest answer',
  'reply.toggleExplanation': 'Collapse or expand explanations',
  'history.search': 'Search all chats',
  'history.pinCurrent': 'Pin or unpin the open chat',
  'app.toggleSidebar': 'Show or hide the chat list',
  'app.settings': 'Open settings',
  'theme.next': 'Next theme',
};

/** Names of the global hotkeys, for clash messages. */
export const GLOBAL_HOTKEY_LABELS = {
  regionSnip: 'Region snip',
  fullScreenshot: 'Full screenshot',
  togglePanel: 'Show/hide panel',
  focusPanel: 'Focus the panel',
};

/** Groups in the order the Keys tab lists them; others follow alphabetically. */
const GROUP_ORDER = ['App', 'Chat', 'Reply', 'History', 'Panel', 'Theme', 'Capture', 'Window'];

function groupFor(id) {
  const head = id.split('.')[0];
  return { app: 'App', chat: 'Chat', reply: 'Reply', history: 'History', panel: 'Panel', theme: 'Theme',
    capture: 'Capture', window: 'Window' }[head] || 'General';
}

/**
 * @typedef {{ id: string, title: string, group: string, keys: string, defaultKeys: string,
 *             changed: boolean, clashes: string[], globalClash: string }} KeyRow
 *   keys          the shortcut in effect ('' = none)
 *   changed       the user changed it from the default
 *   clashes       titles of other commands on the same shortcut
 *   globalClash   label of a global hotkey on the same shortcut ('' = none)
 */

/**
 * Every command the Keys tab shows: the registered ones plus any default that
 * isn't registered yet, sorted by group, then title.
 * @param {{ id: string, title: string, group?: string }[]} commands  from listCommands()
 * @param {Record<string,string>} [overrides]  settings.keymap
 * @param {Record<string,string>} [hotkeys]    settings.hotkeys (the global ones)
 * @returns {KeyRow[]}
 */
export function buildKeyRows(commands, overrides, hotkeys) {
  const keymap = resolveKeymap(overrides);
  const byId = new Map();
  for (const c of commands || []) {
    if (!c || !c.id || c.id === 'chat.focusInput') continue; // focused by the global Ctrl+Alt+Space
    byId.set(c.id, { id: c.id, title: c.title || c.id, group: c.group || groupFor(c.id) });
  }
  for (const id of Object.keys(DEFAULT_KEYMAP)) {
    if (!byId.has(id)) byId.set(id, { id, title: FALLBACK_TITLES[id] || id, group: groupFor(id) });
  }
  const globals = new Map();
  for (const [name, acc] of Object.entries(hotkeys || {})) {
    const norm = normalizeAccelerator(acc);
    if (norm) globals.set(norm, GLOBAL_HOTKEY_LABELS[name] || name);
  }
  const rows = [...byId.values()].map((c) => {
    const keys = keymap[c.id] || '';
    const defaultKeys = normalizeAccelerator(DEFAULT_KEYMAP[c.id] || '');
    return { ...c, keys, defaultKeys, changed: keys !== defaultKeys, clashes: [], globalClash: keys ? globals.get(keys) || '' : '' };
  });
  const byKeys = new Map();
  for (const r of rows) {
    if (!r.keys) continue;
    if (!byKeys.has(r.keys)) byKeys.set(r.keys, []);
    byKeys.get(r.keys).push(r);
  }
  for (const group of byKeys.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.clashes = group.filter((o) => o !== r).map((o) => o.title);
  }
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  rows.sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  return rows;
}

/**
 * Check a recorded shortcut before binding it.
 * @param {string} acc
 * @returns {{ ok: true, value: string, note: string } | { ok: false, error: string }}
 *   note is a heads-up that doesn't block (e.g. a plain key that won't work while typing)
 */
export function checkBinding(acc) {
  const value = normalizeAccelerator(acc);
  if (!value) return { ok: false, error: 'That key combination isn’t one Proxy can use.' };
  if (isReserved(value)) return { ok: false, error: `${value} is fixed (send, new line, stop or move focus).` };
  const note = worksWhileTyping(value) ? '' : 'Without Ctrl or Alt this only works when you’re not typing in a box.';
  return { ok: true, value, note };
}

/**
 * The keymap patch for giving `id` the shortcut `acc` ('' turns it off). Going
 * back to the default sends null, so settings keep only real overrides.
 * @param {string} id
 * @param {string} acc
 * @returns {Record<string, string|null>}
 */
export function keymapPatch(id, acc) {
  const value = acc === '' ? '' : normalizeAccelerator(acc);
  const def = normalizeAccelerator(DEFAULT_KEYMAP[id] || '');
  return { [id]: value === def ? null : value };
}

/** Patch that resets every override. */
export function resetAllPatch(overrides) {
  const out = {};
  for (const id of Object.keys(overrides || {})) out[id] = null;
  return out;
}

/**
 * Filter rows by a typed query: matches title, group, id or keys, any order of words.
 * @param {KeyRow[]} rows
 * @param {string} query
 */
export function filterRows(rows, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = `${r.title} ${r.group} ${r.id} ${r.keys}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
