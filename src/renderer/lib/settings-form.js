// OWNER: Worker 3. Turns the settings form's values into a SettingsPatch. Pure, no DOM.

import { validateAccelerator, duplicateHotkeys } from './accelerator.js';

export const HOTKEY_FIELDS = [
  { name: 'regionSnip', label: 'Region snip' },
  { name: 'fullScreenshot', label: 'Full screenshot' },
  { name: 'togglePanel', label: 'Show/hide panel' },
];

export const SEND_MODE_LABELS = {
  instant: 'Send right away',
  wait: 'Attach and wait for my question',
};

export const VISIBILITY_LABELS = {
  always: 'Always shown',
  'hidden-until-capture': 'Hidden until a capture',
  toggle: 'Toggle with hotkey',
};

export const ANSWER_STYLE_LABELS = {
  answer: 'Answer only',
  explanation: 'Explanation only',
  both: 'Answer and explanation',
};

/**
 * @param {{ hotkeys: Record<string,string>, sendMode: string, panelVisibility: string, answerStyle: string }} values
 *        raw form values
 * @param {{ SEND_MODES: object, PANEL_VISIBILITY: object, ANSWER_STYLES: object }} enums
 *        from window.proxy.constants
 * @returns {{ ok: boolean, patch: object, errors: Record<string,string> }}
 *        errors is keyed by field name ("hotkeys.regionSnip", "sendMode", ...)
 */
export function buildSettingsPatch(values, enums) {
  const errors = {};
  const hotkeys = {};
  for (const { name } of HOTKEY_FIELDS) {
    const v = validateAccelerator(values.hotkeys ? values.hotkeys[name] : '');
    if (v.ok) hotkeys[name] = v.value;
    else errors[`hotkeys.${name}`] = v.error;
  }
  for (const group of duplicateHotkeys(hotkeys)) {
    for (const name of group) {
      errors[`hotkeys.${name}`] = 'Same shortcut as another hotkey.';
    }
  }
  const pick = (field, enumObj) => {
    const allowed = Object.values(enumObj || {});
    if (allowed.includes(values[field])) return values[field];
    errors[field] = 'Pick one of the options.';
    return undefined;
  };
  const patch = {
    hotkeys,
    sendMode: pick('sendMode', enums.SEND_MODES),
    panelVisibility: pick('panelVisibility', enums.PANEL_VISIBILITY),
    answerStyle: pick('answerStyle', enums.ANSWER_STYLES),
  };
  const ok = Object.keys(errors).length === 0;
  return { ok, patch: ok ? patch : {}, errors };
}
