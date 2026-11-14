// OWNER: Worker 3. Settings screen: AI provider and model, hotkeys, send mode, panel visibility, answer style.

import { el } from './dom.js';
import { keyEventToAccelerator } from '../lib/accelerator.js';
import {
  ANSWER_STYLE_LABELS,
  CLAUDE_MODEL_LABELS,
  HOTKEY_FIELDS,
  PROVIDER_LABELS,
  SEND_MODE_LABELS,
  VISIBILITY_LABELS,
  buildSettingsPatch,
} from '../lib/settings-form.js';

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
  let dirty = false;
  let stopRecording = null;

  // Hotkey rows.
  const hotkeyBox = form.querySelector('#hotkey-fields');
  for (const { name, label } of HOTKEY_FIELDS) {
    const id = `hotkey-${name}`;
    const input = el('input', { type: 'text', id, name: `hotkeys.${name}`, spellcheck: 'false' });
    const record = el('button', { type: 'button', className: 'btn small', text: 'Record' });
    const clear = el('button', { type: 'button', className: 'btn small', text: 'Clear' });
    const error = el('div', { className: 'field-error', 'aria-live': 'polite' });
    record.addEventListener('click', () => startRecording(input, record));
    clear.addEventListener('click', () => { input.value = ''; markDirty(); });
    hotkeyInputs[name] = input;
    hotkeyErrors[name] = error;
    hotkeyBox.append(
      el('div', { className: 'field' }, [
        el('label', { for: id, text: label }),
        el('div', { className: 'field-row' }, [input, record, clear]),
        error,
      ]),
    );
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

  // The Claude model choice only matters when Claude (Pro) is picked.
  const claudeBox = form.querySelector('#claude-model-box');
  function syncClaudeBox() {
    const picked = form.querySelector('input[name="provider"]:checked');
    if (claudeBox) claudeBox.hidden = !picked || picked.value !== 'claude-pro';
  }
  form.addEventListener('change', (e) => { if (e.target && e.target.name === 'provider') syncClaudeBox(); });

  function markDirty() {
    dirty = true;
    status.textContent = '';
  }
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

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
        return finish();
      }
      const acc = keyEventToAccelerator(e);
      if (acc) {
        input.value = acc;
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
    for (const { name } of HOTKEY_FIELDS) {
      hotkeyInputs[name].value = (settings.hotkeys && settings.hotkeys[name]) || '';
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

  return {
    /** Load settings into the form (when opening the screen). */
    open(settings) {
      fill(settings);
      status.textContent = '';
    },
    /** Settings changed elsewhere: refresh the form unless the user has unsaved edits. */
    externalUpdate(settings) {
      if (!dirty) fill(settings);
    },
    cancelRecording() {
      if (stopRecording) stopRecording();
    },
  };
}
