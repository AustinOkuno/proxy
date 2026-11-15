// OWNER: Worker 1 (UI phase). Command registry shared by every worker (SPEC 9.5.6).
// Step 0 version from the lead: a working registry with no keymap yet. Worker 1
// owns it from here; keep these exports and their shapes.

/** @type {Map<string, { id: string, title: string, group: string, run: Function, when?: Function }>} */
const commands = new Map();

/**
 * Register a command for the command bar and the keymap.
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

/** Run a command by id. Unknown or unavailable commands do nothing. */
export async function runCommand(id) {
  const cmd = commands.get(id);
  if (!cmd || (cmd.when && !cmd.when())) return;
  await cmd.run();
}

/** @returns {{ id: string, title: string, group: string, keys: string }[]} */
export function listCommands() {
  return [...commands.values()].map(({ id, title, group }) => ({ id, title, group, keys: '' }));
}
