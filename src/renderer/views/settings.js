// OWNER: Worker 1 (UI phase). The Settings screen (SPEC 9.3): tabs General,
// Look, Keys and Usage. General holds the AI provider and model, global
// hotkeys, send mode, panel visibility, answer style (saved with Save) and the
// panel's dock and snapping (saved right away). Keys is keys/keys-tab.js; Look
// (W3) and Usage (W2) are mounted into their sections by app.js.
//
// Keyboard: Ctrl+Tab / Ctrl+Shift+Tab or Ctrl+PageDown / Ctrl+PageUp switch
// tabs anywhere in Settings; Left/Right/Home/End move along the tab row.

import { el } from './dom.js';
import { hotkeyWarning, keyEventToAccelerator } from '../lib/accelerator.js';
import {
  ANSWER_STYLE_LABELS,
  CLAUDE_MODEL_LABELS,
  DOCK_LABELS,
  HOTKEY_FIELDS,
  PROVIDER_LABELS,
  SEND_MODE_LABELS,
  VISIBILITY_LABELS,
  buildPanelPatch,
  buildSettingsPatch,
} from '../lib/settings-form.js';
import { registerCommand, runCommand } from '../keys/commands.js';
import { createKeysTab } from '../keys/keys-tab.js';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'look', label: 'Look' },
  { id: 'keys', label: 'Keys' },
  { id: 'usage', label: 'Usage' },
];
const LIVE_HINT = 'Changes on this tab save right away.';

/**
 * @param {{
 *   form: HTMLFormElement,
 *   status: HTMLElement,
 *   constants: { SEND_MODES: object, PANEL_VISIBILITY: object, ANSWER_STYLES: object, PROVIDERS?: object, CLAUDE_MODELS?: object },
 *   save: (patch: object) => Promise<object>,
 *   close: () => void,
 * }} deps
 */
export function createSettingsView({ form, status, constants, save, close }) {
  const hotkeyInputs = {};
  const hotkeyErrors = {};
  const hotkeyWarnings = {};
  let dirty = false;
  let stopRecording = null;
  let current = {};
  const doc = form.ownerDocument;
  const win = doc.defaultView;

  // ---- Tabs ---------------------------------------------------------------
  // index.html has the General fieldsets loose in the form plus empty Look and
  // Usage sections; arrange them into tab panels here.
  const heading = form.querySelector('h2');
  const actions = form.querySelector('.settings-actions');
  const saveBtn = form.querySelector('#btn-settings-save');
  const panels = {
    general: el('section', { className: 'settings-tab', id: 'settings-general', dataset: { tab: 'general' } }),
    look: form.querySelector('#settings-look') || el('section', { className: 'settings-tab', id: 'settings-look' }),
    keys: el('section', { className: 'settings-tab', id: 'settings-keys', dataset: { tab: 'keys' } }),
    usage: form.querySelector('#settings-usage') || el('section', { className: 'settings-tab', id: 'settings-usage' }),
  };
  for (const node of [...form.children]) {
    if (node.tagName === 'FIELDSET') panels.general.append(node);
  }
  const tablist = el('div', { className: 'settings-tabs', role: 'tablist', 'aria-label': 'Settings sections' });
  const tabButtons = {};
  for (const { id, label } of TABS) {
    const b = el('button', {
      type: 'button',
      className: 'settings-tab-btn',
      role: 'tab',
      id: `settings-tab-${id}`,
      'aria-controls': panels[id].id,
      dataset: { tab: id },
      text: label,
    });
    b.addEventListener('click', () => selectTab(id, { focus: 'tab' }));
    tabButtons[id] = b;
    tablist.append(b);
    panels[id].setAttribute('role', 'tabpanel');
    panels[id].setAttribute('aria-labelledby', b.id);
    panels[id].removeAttribute('aria-label');
  }
  if (heading) heading.after(tablist);
  else form.prepend(tablist);
  for (const { id } of TABS) form.insertBefore(panels[id], actions || null);

  let activeTab = 'general';
  let focusTicket = 0;
  function selectTab(id, { focus } = {}) {
    if (!panels[id]) return;
    if (id !== activeTab) {
      if (stopRecording) stopRecording();
      keysTab.cancelRecording();
    }
    activeTab = id;
    for (const { id: t } of TABS) {
      const on = t === id;
      panels[t].hidden = !on;
      tabButtons[t].setAttribute('aria-selected', String(on));
      tabButtons[t].tabIndex = on ? 0 : -1;
      tabButtons[t].classList.toggle('active', on);
    }
    // Only General has a Save button; the other tabs save as you change them.
    if (saveBtn) saveBtn.hidden = id !== 'general';
    status.textContent = id === 'general' ? '' : LIVE_HINT;
    if (id === 'keys') keysTab.update(current);
    if (!focus) return;
    const ticket = ++focusTicket; // a later request wins over a deferred one
    const doFocus = () => {
      if (ticket !== focusTicket || activeTab !== id || !settingsShown()) return;
      if (focus === 'tab') tabButtons[id].focus();
      else focusContent(id);
    };
    // Settings may still be hidden (app.js shows it right after open()), so then focus a moment later.
    if (settingsShown()) doFocus();
    else setTimeout(doFocus, 0);
  }

  function focusContent(id) {
    if (id === 'keys') return keysTab.focus();
    const first = panels[id].querySelector('input:not([type="hidden"]):not(:disabled), select, textarea, button:not(:disabled)');
    if (first) first.focus();
    else tabButtons[id].focus();
  }

  function stepTab(delta) {
    const i = TABS.findIndex((t) => t.id === activeTab);
    selectTab(TABS[(i + delta + TABS.length) % TABS.length].id, { focus: 'tab' });
  }

  tablist.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (e.key in keys) stepTab(keys[e.key]);
    else if (e.key === 'Home') selectTab(TABS[0].id, { focus: 'tab' });
    else if (e.key === 'End') selectTab(TABS[TABS.length - 1].id, { focus: 'tab' });
    else if (e.key === 'ArrowDown') focusContent(activeTab);
    else return;
    e.preventDefault();
  });

  const settingsShown = () => {
    const view = form.closest('.settings') || form;
    return !view.hidden && !form.hidden;
  };
  // Window capture phase, so it runs before the keymap (Ctrl+Tab is "next chat" outside Settings).
  win.addEventListener('keydown', (e) => {
    if (e.isComposing || !settingsShown() || stopRecording || keysTab.isRecording()) return;
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    let delta = 0;
    if (e.key === 'Tab') delta = e.shiftKey ? -1 : 1;
    else if (e.key === 'PageDown' && !e.shiftKey) delta = 1;
    else if (e.key === 'PageUp' && !e.shiftKey) delta = -1;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    stepTab(delta);
  }, true);

  // ---- Keys tab -----------------------------------------------------------
  const keysTab = createKeysTab(panels.keys, {
    save: (patch) => save(patch),
    onSaved: (s) => { current = s; },
  });

  // Hotkey rows.
  const hotkeyBox = form.querySelector('#hotkey-fields');
  for (const { name, label } of HOTKEY_FIELDS) {
    const id = `hotkey-${name}`;
    const input = el('input', { type: 'text', id, name: `hotkeys.${name}`, spellcheck: 'false' });
    const record = el('button', { type: 'button', className: 'btn small', text: 'Record' });
    const clear = el('button', { type: 'button', className: 'btn small', text: 'Clear' });
    const error = el('div', { className: 'field-error', 'aria-live': 'polite' });
    const warning = el('div', { className: 'field-warning', 'aria-live': 'polite' });
    record.addEventListener('click', () => startRecording(input, record));
    clear.addEventListener('click', () => { input.value = ''; updateWarning(name); markDirty(); });
    input.addEventListener('input', () => updateWarning(name));
    hotkeyInputs[name] = input;
    hotkeyErrors[name] = error;
    hotkeyWarnings[name] = warning;
    hotkeyBox.append(
      el('div', { className: 'field' }, [
        el('label', { for: id, text: label }),
        el('div', { className: 'field-row' }, [input, record, clear]),
        error,
        warning,
      ]),
    );
  }

  function updateWarning(name) {
    hotkeyWarnings[name].textContent = hotkeyWarning(hotkeyInputs[name].value);
  }

  // Radio groups.
  function radios(containerId, name, enumObj, labels) {
    const box = form.querySelector(containerId);
    for (const value of Object.values(enumObj)) {
      const id = `${name}-${value}`;
      box.append(
        el('label', { className: 'option', for: id }, [
          el('input', { type: 'radio', name, id, value }),
          el('span', { text: labels[value] || value }),
        ]),
      );
    }
  }
  radios('#send-mode-options', 'sendMode', constants.SEND_MODES, SEND_MODE_LABELS);
  radios('#visibility-options', 'panelVisibility', constants.PANEL_VISIBILITY, VISIBILITY_LABELS);
  radios('#answer-style-options', 'answerStyle', constants.ANSWER_STYLES, ANSWER_STYLE_LABELS);
  if (constants.PROVIDERS) radios('#provider-options', 'provider', constants.PROVIDERS, PROVIDER_LABELS);
  if (constants.CLAUDE_MODELS) radios('#claude-model-options', 'claudeModel', constants.CLAUDE_MODELS, CLAUDE_MODEL_LABELS);
  const RADIO_FIELDS = ['provider', 'claudeModel', 'sendMode', 'panelVisibility', 'answerStyle'];

  // ---- Panel: dock and snapping (saved right away) -------------------------
  const docks = constants.PANEL_DOCKS ? Object.values(constants.PANEL_DOCKS) : Object.keys(DOCK_LABELS);
  const marginLimits = (constants.SETTINGS_LIMITS && constants.SETTINGS_LIMITS.panelMargin) || { min: 0, max: 64 };
  const snapDistance = (constants.SETTINGS_LIMITS && constants.SETTINGS_LIMITS.snapDistance) || 48;
  const dockBox = el('div', { className: 'options dock-options' });
  for (const value of docks) {
    const id = `panelDock-${value}`;
    dockBox.append(
      el('label', { className: 'option', for: id }, [
        el('input', { type: 'radio', name: 'panelDock', id, value }),
        el('span', { text: DOCK_LABELS[value] || value }),
      ]),
    );
  }
  const snapInput = el('input', { type: 'checkbox', id: 'panel-snap', name: 'panelSnap' });
  const marginInput = el('input', {
    type: 'number', id: 'panel-margin', name: 'panelMargin', min: marginLimits.min, max: marginLimits.max, step: 1,
    className: 'panel-margin',
  });
  const panelError = el('div', { className: 'field-error', 'aria-live': 'polite' });
  const panelStatus = el('span', { className: 'muted panel-status', 'aria-live': 'polite' });
  const panelBox = el('fieldset', { className: 'panel-fields' }, [
    el('legend', { text: 'Panel position' }),
    el('p', {
      className: 'muted hint',
      text: `Alt+1 to Alt+4 dock it from the keyboard. These save right away.`,
    }),
    el('div', { className: 'field-label', text: 'Dock' }),
    dockBox,
    el('label', { className: 'option panel-snap', for: 'panel-snap' }, [
      snapInput,
      el('span', { text: `Snap to a corner when I let go of a drag within ${snapDistance} px of it` }),
    ]),
    el('div', { className: 'field' }, [
      el('label', { for: 'panel-margin', text: `Gap from the screen edge when docked (${marginLimits.min} to ${marginLimits.max} px)` }),
      el('div', { className: 'field-row' }, [marginInput, panelStatus]),
      panelError,
    ]),
  ]);
  // Right after "Panel visibility", so everything about the panel sits together.
  const visibilitySet = form.querySelector('#visibility-options');
  const visibilityBox = visibilitySet && visibilitySet.closest('fieldset');
  if (visibilityBox && panels.general.contains(visibilityBox)) visibilityBox.after(panelBox);
  else panels.general.append(panelBox);

  async function savePanel(values) {
    const { ok, patch, errors } = buildPanelPatch(values, constants);
    const saved0 = (current && current.panel) || {};
    if (patch.panel) {
      for (const k of Object.keys(patch.panel)) if (patch.panel[k] === saved0[k]) delete patch.panel[k];
      if (!Object.keys(patch.panel).length) delete patch.panel;
    }
    panelError.textContent = errors['panel.margin'] || errors['panel.dock'] || '';
    marginInput.classList.toggle('invalid', !!errors['panel.margin']);
    if (!ok || !patch.panel) return;
    panelStatus.textContent = 'Saving…';
    try {
      const saved = await save(patch);
      if (saved) {
        current = saved;
        fillPanel(saved);
      }
      panelStatus.textContent = 'Saved.';
    } catch (err) {
      panelStatus.textContent = `Couldn't save: ${(err && err.message) || err}`;
    }
  }

  dockBox.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'panelDock') savePanel({ dock: e.target.value });
  });
  snapInput.addEventListener('change', () => savePanel({ snap: snapInput.checked }));
  marginInput.addEventListener('change', () => savePanel({ margin: marginInput.value }));
  marginInput.addEventListener('keydown', (e) => {
    // Enter saves the gap, not the whole form.
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      savePanel({ margin: marginInput.value });
    }
  });

  function fillPanel(s) {
    const p = (s && s.panel) || {};
    const radio = dockBox.querySelector(`input[value="${p.dock}"]`);
    if (radio) radio.checked = true;
    snapInput.checked = p.snap !== false;
    if (doc.activeElement !== marginInput) marginInput.value = Number.isFinite(p.margin) ? String(p.margin) : '';
    panelError.textContent = '';
    marginInput.classList.remove('invalid');
  }

  // ---- Commands: jump straight to a tab -----------------------------------
  for (const { id, label } of TABS) {
    registerCommand({
      id: `settings.${id}`,
      title: `Settings: ${label}`,
      group: 'App',
      run: async () => {
        await runCommand('app.settings');
        selectTab(id, { focus: 'content' });
      },
    });
  }

  // The Claude model choice only matters when Claude (Pro) is picked.
  const claudeBox = form.querySelector('#claude-model-box');
  function syncClaudeBox() {
    const picked = form.querySelector('input[name="provider"]:checked');
    if (claudeBox) claudeBox.hidden = !picked || picked.value !== 'claude-pro';
  }
  form.addEventListener('change', (e) => { if (e.target && e.target.name === 'provider') syncClaudeBox(); });

  function markDirty() {
    dirty = true;
    if (activeTab === 'general') status.textContent = '';
  }
  // Only General's own fields wait for Save; the panel box and the other tabs save as they change.
  const waitsForSave = (e) => e.target && panels.general.contains(e.target) && !panelBox.contains(e.target);
  form.addEventListener('input', (e) => { if (waitsForSave(e)) markDirty(); });
  form.addEventListener('change', (e) => { if (waitsForSave(e)) markDirty(); });

  function startRecording(input, button) {
    if (stopRecording) stopRecording();
    const before = input.value;
    button.textContent = 'Press keys…';
    input.classList.add('recording');
    input.focus();
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        input.value = before;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return finish();
      }
      const acc = keyEventToAccelerator(e);
      if (acc) {
        input.value = acc;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        markDirty();
        finish();
      }
    };
    const finish = () => {
      window.removeEventListener('keydown', onKey, true);
      input.removeEventListener('blur', finish);
      input.classList.remove('recording');
      button.textContent = 'Record';
      stopRecording = null;
    };
    window.addEventListener('keydown', onKey, true);
    input.addEventListener('blur', finish);
    stopRecording = finish;
  }

  function readValues() {
    const data = new FormData(form);
    const hotkeys = {};
    for (const { name } of HOTKEY_FIELDS) hotkeys[name] = hotkeyInputs[name].value;
    return {
      hotkeys,
      sendMode: data.get('sendMode'),
      panelVisibility: data.get('panelVisibility'),
      answerStyle: data.get('answerStyle'),
      provider: data.get('provider'),
      claudeModel: data.get('claudeModel'),
    };
  }

  function showErrors(errors) {
    for (const { name } of HOTKEY_FIELDS) {
      const msg = errors[`hotkeys.${name}`] || '';
      hotkeyErrors[name].textContent = msg;
      hotkeyInputs[name].classList.toggle('invalid', !!msg);
    }
  }

  function fill(settings) {
    current = settings || {};
    fillPanel(current);
    for (const { name, fallback } of HOTKEY_FIELDS) {
      const saved = settings.hotkeys ? settings.hotkeys[name] : undefined;
      hotkeyInputs[name].value = saved ?? fallback ?? '';
      updateWarning(name);
    }
    for (const field of RADIO_FIELDS) {
      const radio = form.querySelector(`input[name="${field}"][value="${settings[field]}"]`);
      if (radio) radio.checked = true;
    }
    syncClaudeBox();
    showErrors({});
    dirty = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Enter in a field on another tab must not save General behind the user's back.
    if (activeTab !== 'general') return;
    const { ok, patch, errors } = buildSettingsPatch(readValues(), constants);
    showErrors(errors);
    if (!ok) {
      status.textContent = 'Fix the highlighted fields.';
      return;
    }
    status.textContent = 'Saving…';
    try {
      const saved = await save(patch);
      fill(saved);
      status.textContent = 'Saved.';
    } catch (err) {
      status.textContent = `Couldn't save: ${(err && err.message) || err}`;
    }
  });

  form.querySelector('#btn-settings-cancel').addEventListener('click', () => {
    if (stopRecording) stopRecording();
    close();
  });

  selectTab('general');

  return {
    /** Load settings into the form (when opening the screen). */
    open(settings) {
      fill(settings);
      // Reopen on the tab used last, with focus on its tab so arrows work at once.
      selectTab(activeTab, { focus: 'tab' });
    },
    /** Settings changed elsewhere: refresh the form unless the user has unsaved edits. */
    externalUpdate(settings) {
      if (!settings) return;
      current = settings;
      fillPanel(settings); // dock changes from Alt+1..4 or a drag show at once
      keysTab.update(settings);
      if (!dirty) fill(settings);
    },
    /** Show a tab: 'general', 'look', 'keys' or 'usage'. */
    selectTab(id) {
      selectTab(id, { focus: 'content' });
    },
    cancelRecording() {
      if (stopRecording) stopRecording();
      keysTab.cancelRecording();
    },
  };
}
