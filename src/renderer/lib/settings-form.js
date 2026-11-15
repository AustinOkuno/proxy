// OWNER: Worker 1 (UI phase). Turns the settings form's values into a SettingsPatch. Pure, no DOM.

import { validateAccelerator, duplicateHotkeys } from './accelerator.js';

export const HOTKEY_FIELDS = [
  { name: 'regionSnip', label: 'Region snip' },
  { name: 'fullScreenshot', label: 'Full screenshot' },
  { name: 'togglePanel', label: 'Show/hide panel' },
  // Optional: older settings don't have it, and the patch only carries it when the form does.
  { name: 'focusPanel', label: 'Focus the panel (press again to give focus back)', optional: true, fallback: 'Ctrl+Alt+Space' },
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

export const PROVIDER_LABELS = {
  gemini: 'Gemini (free API key in .env)',
  'claude-pro': 'Claude (Pro), using your Claude subscription',
};

export const CLAUDE_MODEL_LABELS = {
  haiku: 'Haiku: fastest (recommended)',
  sonnet: 'Sonnet: smarter, a bit slower',
  opus: 'Opus: smartest, slowest, uses your limit fastest',
};

/**
 * @param {{ hotkeys: Record<string,string>, sendMode: string, panelVisibility: string, answerStyle: string,
 *           provider?: string, claudeModel?: string }} values
 *        raw form values
 * @param {{ SEND_MODES: object, PANEL_VISIBILITY: object, ANSWER_STYLES: object, PROVIDERS?: object, CLAUDE_MODELS?: object }} enums
 *        from window.proxy.constants (provider fields are only included when their enum is given)
 * @returns {{ ok: boolean, patch: object, errors: Record<string,string> }}
 *        errors is keyed by field name ("hotkeys.regionSnip", "sendMode", ...)
 */
export function buildSettingsPatch(values, enums) {
  const errors = {};
  const hotkeys = {};
  for (const { name, optional } of HOTKEY_FIELDS) {
    const raw = values.hotkeys ? values.hotkeys[name] : undefined;
    if (optional && raw === undefined) continue;
    const v = validateAccelerator(raw ?? '');
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
  if (enums.PROVIDERS) patch.provider = pick('provider', enums.PROVIDERS);
  if (enums.CLAUDE_MODELS) patch.claudeModel = pick('claudeModel', enums.CLAUDE_MODELS);
  const ok = Object.keys(errors).length === 0;
  return { ok, patch: ok ? patch : {}, errors };
}

/** Labels for the dock choices on the General tab, in screen order. */
export const DOCK_LABELS = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
  free: 'Free (stays where I drop it)',
};

/**
 * Turn the Panel section's values into a `panel` settings patch. Only the
 * fields given are included; the margin is rounded and kept in range.
 * @param {{ dock?: string, snap?: boolean, margin?: number|string }} values
 * @param {{ PANEL_DOCKS?: object, SETTINGS_LIMITS?: { panelMargin?: { min: number, max: number } } }} enums
 * @returns {{ ok: boolean, patch: object, errors: Record<string,string> }}
 */
export function buildPanelPatch(values, enums = {}) {
  const errors = {};
  const panel = {};
  const v = values || {};
  if (v.dock !== undefined) {
    const docks = Object.values(enums.PANEL_DOCKS || DOCK_LABELS_KEYS);
    if (docks.includes(v.dock)) panel.dock = v.dock;
    else errors['panel.dock'] = 'Pick one of the corners.';
  }
  if (v.snap !== undefined) panel.snap = !!v.snap;
  if (v.margin !== undefined) {
    const L = (enums.SETTINGS_LIMITS && enums.SETTINGS_LIMITS.panelMargin) || { min: 0, max: 64 };
    const n = typeof v.margin === 'string' && v.margin.trim() === '' ? NaN : Number(v.margin);
    if (Number.isFinite(n)) panel.margin = Math.min(L.max, Math.max(L.min, Math.round(n)));
    else errors['panel.margin'] = `Type a number from ${L.min} to ${L.max}.`;
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, patch: ok && Object.keys(panel).length ? { panel } : {}, errors };
}

const DOCK_LABELS_KEYS = Object.keys(DOCK_LABELS);
