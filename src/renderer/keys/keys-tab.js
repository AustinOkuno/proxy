// OWNER: Worker 1 (UI phase). Settings > Keys (SPEC 9.6): every in-panel
// command with its shortcut. Pick a row and press Enter to record new keys,
// Backspace or Delete to turn a shortcut off, R to put the default back.
// Changes save right away. Clashes with other commands or with a global
// hotkey are shown under the row.

import { el } from '../views/dom.js';
import { keyEventToAccelerator } from '../lib/accelerator.js';
import { listCommands } from './commands.js';
import { buildKeyRows, checkBinding, keymapPatch, resetAllPatch, filterRows } from './keys-editor.js';

const isPlainKey = (e, key) => e.key === key && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;

/**
 * @param {HTMLElement} container
 * @param {{ save: (patch: object) => Promise<object>, onSaved?: (settings: object) => void }} deps
 */
export function createKeysTab(container, { save, onSaved }) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  let settings = {};
  let query = '';
  /** id of the row whose shortcut button should keep focus after a re-render. */
  let focusId = null;
  /** Transient messages per row: id -> { kind: 'error'|'note', text } */
  const messages = new Map();
  let stopRecording = null;

  const filter = el('input', {
    type: 'search',
    className: 'keys-filter',
    placeholder: 'Filter commands or keys…',
    'aria-label': 'Filter commands',
    spellcheck: 'false',
  });
  const list = el('ul', { className: 'keys-list', 'aria-label': 'Shortcuts' });
  const resetAll = el('button', { type: 'button', className: 'btn small', text: 'Reset all to defaults' });
  const summary = el('span', { className: 'muted keys-summary', 'aria-live': 'polite' });

  container.append(
    el('fieldset', {}, [
      el('legend', { text: 'In-panel shortcuts' }),
      el('p', {
        className: 'muted hint',
        text: 'These work while the panel has focus. Pick a shortcut and press Enter to record new keys, ' +
          'Backspace to turn it off, or R for the default. Arrow keys move between rows. ' +
          'Changes save right away. The global hotkeys are on the General tab.',
      }),
      el('div', { className: 'field-row keys-toolbar' }, [filter, resetAll]),
      list,
      el('div', { className: 'keys-footer' }, [summary]),
    ]),
  );

  function buttons() {
    return [...list.querySelectorAll('.keys-record')];
  }

  function focusRow(id) {
    const b = list.querySelector(`.keys-record[data-id="${CSS.escape(id)}"]`);
    if (b) b.focus();
    return !!b;
  }

  function render() {
    const all = buildKeyRows(listCommands(), settings.keymap, settings.hotkeys);
    const rows = filterRows(all, query);
    const items = [];
    let group = null;
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group;
        items.push(el('li', { className: 'keys-group', role: 'presentation', text: group }));
      }
      items.push(renderRow(r));
    }
    if (!rows.length) items.push(el('li', { className: 'keys-empty muted', text: 'No commands match.' }));
    const hadFocus = list.contains(doc.activeElement);
    list.replaceChildren(...items);
    const changed = all.filter((r) => r.changed).length;
    const clashes = all.filter((r) => r.clashes.length || r.globalClash).length;
    summary.textContent = [
      changed ? `${changed} changed` : 'All defaults',
      clashes ? `${clashes} with a clash` : '',
    ].filter(Boolean).join(' · ');
    resetAll.disabled = !changed;
    if (focusId && (hadFocus || doc.activeElement === doc.body)) focusRow(focusId);
  }

  function renderRow(r) {
    const recording = stopRecording && focusId === r.id;
    const keyBtn = el('button', {
      type: 'button',
      className: `btn small keys-record${recording ? ' recording' : ''}${r.keys ? '' : ' unset'}`,
      dataset: { id: r.id },
      'aria-label': `${r.title}: ${r.keys || 'no shortcut'}. Press Enter to change.`,
    }, [recording ? 'Press keys… (Esc cancels)' : el('kbd', { className: 'kbd', text: r.keys || 'none' })]);
    keyBtn.addEventListener('click', () => record(r));
    keyBtn.addEventListener('focus', () => { focusId = r.id; });
    keyBtn.addEventListener('keydown', (e) => onRowKey(e, r));

    const reset = r.changed
      ? el('button', {
        type: 'button',
        className: 'btn small keys-reset',
        title: r.defaultKeys ? `Back to ${r.defaultKeys}` : 'Back to no shortcut',
        text: 'Default',
        tabindex: '-1',
      })
      : null;
    if (reset) reset.addEventListener('click', () => apply(r, null));

    const notes = [];
    const msg = messages.get(r.id);
    if (msg) notes.push(el('div', { className: msg.kind === 'error' ? 'field-error' : 'field-warning', text: msg.text }));
    if (r.globalClash) {
      notes.push(el('div', { className: 'field-warning', text: `The global “${r.globalClash}” hotkey uses ${r.keys}, so it wins.` }));
    }
    if (r.clashes.length) {
      notes.push(el('div', { className: 'field-warning', text: `Also used by: ${r.clashes.join(', ')}.` }));
    }

    return el('li', {
      className: `keys-row${r.changed ? ' is-changed' : ''}${r.clashes.length || r.globalClash ? ' has-clash' : ''}`,
    }, [
      el('span', { className: 'keys-title', text: r.title }),
      el('span', { className: 'keys-actions' }, [reset, keyBtn]),
      notes.length ? el('div', { className: 'keys-notes' }, notes) : null,
    ]);
  }

  function onRowKey(e, r) {
    if (stopRecording) return;
    const all = buttons();
    const i = all.indexOf(e.currentTarget);
    let handled = true;
    if (isPlainKey(e, 'ArrowDown')) (all[i + 1] || all[i]).focus();
    else if (isPlainKey(e, 'ArrowUp')) {
      if (i <= 0) filter.focus();
      else all[i - 1].focus();
    } else if (isPlainKey(e, 'Home')) all[0] && all[0].focus();
    else if (isPlainKey(e, 'End')) all[all.length - 1] && all[all.length - 1].focus();
    else if (isPlainKey(e, 'Backspace') || isPlainKey(e, 'Delete')) apply(r, '');
    else if (isPlainKey(e, 'r') || (e.key === 'R' && e.shiftKey && !e.ctrlKey && !e.altKey)) {
      if (r.changed) apply(r, null);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && /\S/.test(e.key)) {
      // Typing on a row starts a new search in the filter.
      filter.focus();
      filter.value = e.key;
      query = filter.value;
      render();
      filter.focus();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Save a change: an accelerator, '' to turn it off, or null for the default. */
  async function apply(r, acc) {
    focusId = r.id;
    const patch = acc === null ? { [r.id]: null } : keymapPatch(r.id, acc);
    try {
      const saved = await save({ keymap: patch });
      if (saved) {
        settings = saved;
        if (onSaved) onSaved(saved);
      }
      if (acc === '') messages.set(r.id, { kind: 'note', text: 'Turned off. Press R to put the default back.' });
    } catch (err) {
      messages.set(r.id, { kind: 'error', text: `Couldn't save: ${(err && err.message) || err}` });
    }
    render();
  }

  function record(r) {
    if (stopRecording) stopRecording();
    focusId = r.id;
    messages.delete(r.id);
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPlainKey(e, 'Escape')) return finish();
      if (isPlainKey(e, 'Backspace') || isPlainKey(e, 'Delete')) {
        finish();
        return apply(r, '');
      }
      const acc = keyEventToAccelerator(e);
      if (!acc) return; // only modifiers so far
      const check = checkBinding(acc);
      finish();
      if (!check.ok) {
        messages.set(r.id, { kind: 'error', text: check.error });
        render();
        return;
      }
      if (check.note) messages.set(r.id, { kind: 'note', text: check.note });
      apply(r, check.value);
    };
    const onBlur = () => setTimeout(() => { if (stopRecording === finish) { finish(); } }, 0);
    function finish() {
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('blur', onBlur);
      stopRecording = null;
      render();
    }
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('blur', onBlur);
    stopRecording = finish;
    render();
  }

  filter.addEventListener('input', () => {
    query = filter.value;
    render();
  });
  filter.addEventListener('keydown', (e) => {
    if (isPlainKey(e, 'ArrowDown') || isPlainKey(e, 'Enter')) {
      e.preventDefault();
      e.stopPropagation(); // Enter must not submit the settings form
      const first = buttons()[0];
      if (first) first.focus();
    } else if (isPlainKey(e, 'Escape') && filter.value) {
      e.preventDefault();
      e.stopPropagation(); // clear the filter first; a second Esc closes Settings
      filter.value = '';
      query = '';
      render();
    }
  });

  resetAll.addEventListener('click', async () => {
    const patch = resetAllPatch(settings.keymap);
    if (!Object.keys(patch).length) return;
    messages.clear();
    try {
      const saved = await save({ keymap: patch });
      if (saved) settings = saved;
    } catch (err) {
      summary.textContent = `Couldn't reset: ${(err && err.message) || err}`;
      return;
    }
    render();
  });

  return {
    /** Show the latest settings (and any commands registered since). */
    update(next) {
      if (next) settings = next;
      if (!stopRecording) render();
    },
    /** Put focus on the filter (when the tab is opened from the keyboard). */
    focus() {
      if (!(focusId && focusRow(focusId))) filter.focus();
    },
    cancelRecording() {
      if (stopRecording) stopRecording();
    },
    isRecording: () => !!stopRecording,
  };
}
