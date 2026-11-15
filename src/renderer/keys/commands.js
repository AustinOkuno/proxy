// OWNER: Worker 1 (UI phase). Command registry shared by every worker (SPEC 9.5.6).
// No DOM here, so it runs under node --test.

/** @type {Map<string, { id: string, title: string, group: string, run: Function, when?: Function }>} */
const commands = new Map();

/** commandId -> accelerator in effect (set by mountKeys from the keymap). */
let keymap = {};

/**
 * Register a command for the command bar and the keymap. Registering an id
 * again replaces the earlier command.
 * @param {{ id: string, title: string, group?: string, run: () => any, when?: () => boolean }} cmd
 * @returns {() => void} unregister
 */
export function registerCommand({ id, title, group = 'General', run, when }) {
  if (!id || typeof run !== 'function') throw new Error('registerCommand needs an id and a run function');
  const entry = { id, title: title || id, group, run, when };
  commands.set(id, entry);
  return () => {
    if (commands.get(id) === entry) commands.delete(id);
  };
}

/** True if the command is registered and its `when` allows it now. */
export function isAvailable(id) {
  const cmd = commands.get(id);
  if (!cmd) return false;
  try {
    return !cmd.when || !!cmd.when();
  } catch {
    return false;
  }
}

/** Run a command by id. Unknown or unavailable commands do nothing. */
export async function runCommand(id) {
  if (!isAvailable(id)) return;
  await commands.get(id).run();
}

/** @returns {{ id: string, title: string, group: string, keys: string }[]} */
export function listCommands() {
  return [...commands.values()].map(({ id, title, group }) => ({ id, title, group, keys: keymap[id] || '' }));
}

/** Set the shortcut shown next to each command (commandId -> accelerator). */
export function setKeymap(next) {
  keymap = { ...(next || {}) };
}
