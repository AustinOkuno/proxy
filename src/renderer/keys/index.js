// OWNER: Worker 1 (UI phase). Keymap and the Ctrl+K command bar (SPEC 9.5.6, 9.6).

import { registerCommand, runCommand, listCommands, isAvailable, setKeymap } from './commands.js';
import { createCommandBar } from './cmdbar.js';
import { resolveKeymap, buildLookup, eventAccelerator, worksWhileTyping } from './keymap.js';

export { registerCommand, runCommand, listCommands };
export { DEFAULT_KEYMAP, resolveKeymap, normalizeAccelerator, findConflicts } from './keymap.js';

const DOCK_COMMANDS = [
  ['top-left', 'Dock the panel top left'],
  ['top-right', 'Dock the panel top right'],
  ['bottom-left', 'Dock the panel bottom left'],
  ['bottom-right', 'Dock the panel bottom right'],
];

// After the window gains focus (Ctrl+Alt+Space, or a click), wait this long
// before moving the cursor to the message box, so a click can claim focus first.
const FOCUS_SETTLE_MS = 120;

/** @type {ReturnType<typeof createCommandBar>|null} */
let bar = null;

/**
 * Open the command bar. With no options it lists every command; pass `items`
 * to show your own list (W2's chat.switch lists chats this way).
 * @param {{ items?: { id: string, title: string, group?: string, keys?: string, run: () => any }[],
 *           placeholder?: string, emptyText?: string, query?: string }} [opts]
 */
export function openCommandBar(opts) {
  if (bar) bar.open(opts);
}

/** Close the command bar if it is open. */
export function closeCommandBar() {
  if (bar) bar.close();
}

function isEditable(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(node.type);
}

/**
 * Install the keymap and the command bar.
 * @param {{ proxy: any, settings: object, onSettings: (cb: (s: object) => void) => () => void, root: HTMLElement }} ctx
 */
export function mountKeys({ proxy, settings, onSettings, root }) {
  const doc = (root && root.ownerDocument) || document;
  let lookup = new Map();

  function applyKeymap(s) {
    const keymap = resolveKeymap(s && s.keymap);
    setKeymap(keymap);
    lookup = buildLookup(keymap);
  }
  applyKeymap(settings);
  if (onSettings) onSettings(applyKeymap);

  bar = createCommandBar(root || doc.body, {
    defaultItems: () =>
      listCommands()
        .filter((c) => c.id !== 'app.commandBar' && isAvailable(c.id))
        .map((c) => ({ ...c, run: () => runCommand(c.id) })),
  });

  // W1's own commands.
  registerCommand({
    id: 'app.commandBar',
    title: 'Open the command bar',
    group: 'App',
    run: () => (bar.isOpen() ? bar.close() : bar.open()),
  });
  for (const [corner, title] of DOCK_COMMANDS) {
    registerCommand({
      id: `panel.dock.${corner}`,
      title,
      group: 'Panel',
      run: () => proxy.window.dock(corner),
    });
  }

  // Shortcuts. Capture phase, so they work wherever focus is in the panel.
  // (The Settings "Record" button listens on window in the capture phase and
  // stops the event, so recording a shortcut never runs one.)
  doc.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing || e.repeat) return;
      const acc = eventAccelerator(e);
      if (!acc) return;
      const ids = lookup.get(acc);
      if (!ids) return;
      if (bar.isOpen()) {
        // While the bar is open only its own shortcut works (it closes it);
        // every other key goes to the bar's input.
        if (!ids.includes('app.commandBar')) return;
        e.preventDefault();
        e.stopPropagation();
        bar.close();
        return;
      }
      if (isEditable(e.target) && !worksWhileTyping(acc)) return;
      const id = ids.find(isAvailable);
      if (!id) return; // e.g. a W2/W3 command that isn't registered yet: let the key through
      e.preventDefault();
      e.stopPropagation();
      runCommand(id).catch((err) => console.warn(`[keys] ${id} failed:`, err));
    },
    true,
  );

  // Ctrl+Alt+Space (SPEC 9.6): when the panel gains focus and nothing inside
  // it has focus, put the cursor in the message box. A click that lands in the
  // meantime wins.
  const win = doc.defaultView;
  if (win) {
    let pending = null;
    win.addEventListener('focus', () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        const a = doc.activeElement;
        if (bar.isOpen() || (a && a !== doc.body)) return;
        const settingsView = doc.getElementById('settings-view');
        if (settingsView && !settingsView.hidden) return;
        runCommand('chat.focusInput').catch(() => {});
      }, FOCUS_SETTLE_MS);
    });
    win.addEventListener('pointerdown', () => {
      clearTimeout(pending);
      pending = null;
    }, true);
  }
}
