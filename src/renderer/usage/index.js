// OWNER: Worker 2 (UI phase). Usage meter and the Usage settings tab (SPEC 9.5.4).
// Step 0 stub from the lead: does nothing yet. Keep the exported shape.

/**
 * @param {HTMLElement} slot
 * @param {{ proxy: any, settings: object, onSettings: (cb: (s: object) => void) => () => void }} ctx
 */
export function mountUsageMeter(_slot, _ctx) {}

/**
 * @param {HTMLElement} container
 * @param {{ proxy: any, settings: object, onSettings: Function, save: (patch: object) => Promise<object> }} ctx
 */
export function mountUsageSettings(_container, _ctx) {}
