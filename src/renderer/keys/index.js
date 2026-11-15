// OWNER: Worker 1 (UI phase). Keymap and the Ctrl+K command bar (SPEC 9.6).
// Step 0 stub from the lead: does nothing yet. Keep the exported shape.

export { registerCommand, runCommand, listCommands } from './commands.js';

/**
 * Install the keymap and the command bar.
 * @param {{ proxy: any, settings: object, onSettings: (cb: (s: object) => void) => () => void, root: HTMLElement }} ctx
 */
export function mountKeys(_ctx) {}
