// OWNER: Worker 3 (UI phase). Theme engine, built-in themes, fonts, backgrounds (SPEC 9.4, 9.5).
// Step 0 stub from the lead: does nothing yet, so theme.css values apply. Keep the exported shape.

/**
 * Apply settings.appearance now and on every change.
 * @param {{ proxy: any, settings: object, onSettings: (cb: (s: object) => void) => () => void }} ctx
 */
export function mountTheme(_ctx) {}

/**
 * Fill the Look tab of Settings.
 * @param {HTMLElement} container
 * @param {{ proxy: any, settings: object, onSettings: Function, save: (patch: object) => Promise<object> }} ctx
 */
export function mountLookSettings(_container, _ctx) {}

/** Built-in themes followed by the user's, for the command bar. @returns {{ id: string, name: string }[]} */
export function listThemes(_settings) {
  return [];
}
