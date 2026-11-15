// OWNER: Worker 3. Electron accelerator helpers for the settings screen. Pure, no DOM.
// https://www.electronjs.org/docs/latest/api/accelerator

const MODIFIERS = new Map(
  [
    'Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl',
    'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta',
  ].map((m) => [m.toLowerCase(), m]),
);

const NAMED_KEYS = [
  'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete',
  'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp',
  'PageDown', 'Escape', 'Esc', 'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack',
  'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
];
for (let i = 1; i <= 24; i++) NAMED_KEYS.push(`F${i}`);
const KEYS = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));

const PUNCTUATION = new Set(")!@#$%^&*(:;+=<,_->.?/~`{][|\\}\"'".split(''));

function normalizeKey(token) {
  if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase();
  if (PUNCTUATION.has(token)) return token;
  return KEYS.get(token.toLowerCase()) || null;
}

/**
 * Validate an accelerator string as typed in settings.
 * Empty (or only spaces) is valid and means "disabled".
 * @param {string} input
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateAccelerator(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, value: '' };
  // "Ctrl++" means Ctrl and the plus key.
  const tokens = raw.replace(/\+\+$/, '+Plus').split('+').map((t) => t.trim());
  if (tokens.some((t) => !t)) return { ok: false, error: 'Use "+" between keys, like Super+Shift+S.' };
  const mods = [];
  const keys = [];
  for (const t of tokens) {
    const mod = MODIFIERS.get(t.toLowerCase());
    if (mod) {
      if (mods.includes(mod)) return { ok: false, error: `"${mod}" is listed twice.` };
      mods.push(mod);
      continue;
    }
    const key = normalizeKey(t);
    if (!key) return { ok: false, error: `"${t}" is not a key Electron knows.` };
    keys.push(key);
  }
  if (keys.length === 0) return { ok: false, error: 'Add a key after the modifiers, like Super+Shift+S.' };
  if (keys.length > 1) return { ok: false, error: 'Use only one non-modifier key.' };
  return { ok: true, value: [...mods, keys[0]].join('+') };
}

const CODE_KEYS = {
  Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Enter: 'Enter', NumpadEnter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left',
  ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Escape: 'Escape', PrintScreen: 'PrintScreen', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

/**
 * Convert a keydown event (or a plain object with the same fields) into an
 * accelerator string, for the "Record" button. Uses `code` so Shift doesn't turn
 * "S" into a different character. Returns null while only modifiers are held.
 * @param {{ code: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean }} ev
 * @returns {string|null}
 */
export function keyEventToAccelerator(ev) {
  const code = String(ev && ev.code || '');
  let key = null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^Digit([0-9])$/.exec(code))) key = m[1];
  else if ((m = /^Numpad([0-9])$/.exec(code))) key = `num${m[1]}`;
  else if ((m = /^F([0-9]{1,2})$/.exec(code)) && Number(m[1]) >= 1 && Number(m[1]) <= 24) key = code;
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  if (!key) return null;
  const parts = [];
  if (ev.ctrlKey) parts.push('Ctrl');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  if (ev.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

/**
 * Names of hotkeys that share the same (non-empty) accelerator.
 * @param {Record<string, string>} hotkeys
 * @returns {string[][]} groups of hotkey names with the same accelerator
 */
export function duplicateHotkeys(hotkeys) {
  const byValue = new Map();
  for (const [name, value] of Object.entries(hotkeys || {})) {
    const v = validateAccelerator(value);
    if (!v.ok || !v.value) continue;
    const k = v.value.toLowerCase();
    if (!byValue.has(k)) byValue.set(k, []);
    byValue.get(k).push(name);
  }
  return [...byValue.values()].filter((names) => names.length > 1);
}

// Shortcuts Linux Mint Cinnamon uses out of the box (lower case, as validateAccelerator writes them).
const CINNAMON_TAKEN = new Set([
  'ctrl+alt+t', 'ctrl+alt+l', 'ctrl+alt+delete', 'ctrl+alt+backspace', 'ctrl+alt+escape',
  'ctrl+alt+up', 'ctrl+alt+down', 'ctrl+alt+left', 'ctrl+alt+right', 'ctrl+alt+d',
  'alt+tab', 'alt+shift+tab', 'alt+f1', 'alt+f2', 'alt+f4', 'alt+f7', 'alt+f8', 'alt+f10',
  'printscreen', 'shift+printscreen', 'alt+printscreen', 'ctrl+printscreen',
]);

/**
 * A non-blocking warning for a hotkey that is likely to clash with Cinnamon.
 * Super combos are unreliable there: pressing Super starts the menu's key grab,
 * so the combo only sometimes reaches Proxy, and some (like Super+S for the
 * sound applet) open a Cinnamon applet instead.
 * @param {string} acc
 * @returns {string} '' when there's nothing to warn about
 */
export function hotkeyWarning(acc) {
  const v = validateAccelerator(acc);
  if (!v.ok || !v.value) return '';
  const parts = v.value.toLowerCase().split('+');
  if (parts.includes('super') || parts.includes('meta')) {
    return 'Super shortcuts are unreliable on Cinnamon (its menu and applets grab Super). Ctrl+Alt+<key> works better.';
  }
  if (CINNAMON_TAKEN.has(v.value.toLowerCase())) {
    return 'Cinnamon already uses this shortcut. Pick another, or free it in System Settings > Keyboard > Shortcuts.';
  }
  return '';
}
