// OWNER: Worker 1 (UI phase). The Ctrl+K command bar (SPEC 9.6): type to
// filter, arrows to move, Enter to run, Esc to close.

import { filterItems } from './fuzzy.js';

/**
 * @typedef {{ id: string, title: string, group?: string, keys?: string, run: () => any }} BarItem
 */

const MAX_ITEMS = 50;

/**
 * Build the command bar inside `root`.
 * @param {HTMLElement} root
 * @param {{ defaultItems: () => BarItem[], onRun?: (item: BarItem) => void }} opts
 */
export function createCommandBar(root, { defaultItems, onRun }) {
  const doc = root.ownerDocument;
  const make = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const bar = make('div', 'cmdbar');
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Command bar');
  bar.hidden = true;
  const input = make('input', 'cmdbar-input');
  input.type = 'text';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Command');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-autocomplete', 'list');
  const list = make('ul', 'cmdbar-list');
  list.id = 'cmdbar-list';
  list.setAttribute('role', 'listbox');
  input.setAttribute('aria-controls', list.id);
  const empty = make('div', 'cmdbar-empty');
  empty.hidden = true;
  bar.append(input, list, empty);
  root.append(bar);

  /** @type {BarItem[]} */
  let source = [];
  /** @type {BarItem[]} */
  let shown = [];
  let active = 0;
  let restoreFocus = null;
  let emptyText = 'No matching commands';

  function render() {
    shown = filterItems(input.value, source).slice(0, MAX_ITEMS);
    if (active >= shown.length) active = Math.max(0, shown.length - 1);
    list.replaceChildren(
      ...shown.map((item, i) => {
        const li = make('li', `cmdbar-item${i === active ? ' active' : ''}`);
        li.id = `cmdbar-item-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.dataset.index = String(i);
        li.append(make('span', 'cmdbar-title', item.title));
        if (item.group) li.append(make('span', 'cmdbar-group', item.group));
        if (item.keys) li.append(make('kbd', 'kbd', item.keys));
        return li;
      }),
    );
    empty.textContent = emptyText;
    empty.hidden = shown.length > 0;
    if (shown.length) input.setAttribute('aria-activedescendant', `cmdbar-item-${active}`);
    else input.removeAttribute('aria-activedescendant');
    const el = list.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!shown.length) return;
    active = (active + delta + shown.length) % shown.length;
    render();
  }

  /**
   * Open the bar. With no options it lists every available command; `items`
   * shows a custom list instead (for example chats, for Ctrl+P).
   * @param {{ items?: BarItem[], placeholder?: string, emptyText?: string, query?: string }} [opts]
   */
  function open(opts = {}) {
    if (bar.hidden) {
      const a = doc.activeElement;
      restoreFocus = a && a !== doc.body && a !== input ? a : null;
    }
    source = Array.isArray(opts.items) ? opts.items : defaultItems();
    input.placeholder = opts.placeholder || 'Type a command…';
    emptyText = opts.emptyText || 'No matching commands';
    input.value = opts.query || '';
    active = 0;
    bar.hidden = false;
    render();
    input.focus();
  }

  /** Close the bar; `restore` puts focus back where it was. */
  function close({ restore = true } = {}) {
    if (bar.hidden) return;
    bar.hidden = true;
    source = [];
    shown = [];
    list.replaceChildren();
    const target = restoreFocus;
    restoreFocus = null;
    if (restore && target && target.isConnected && typeof target.focus === 'function') target.focus();
    else if (doc.activeElement === input) input.blur();
  }

  async function runAt(index) {
    const item = shown[index];
    close();
    if (!item) return;
    if (onRun) onRun(item);
    try {
      await item.run();
    } catch (err) {
      console.warn(`[keys] command ${item.id} failed:`, err);
    }
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    let handled = true;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) || (e.ctrlKey && e.key === 'n')) move(1);
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) || (e.ctrlKey && e.key === 'p')) move(-1);
    else if (e.key === 'PageDown') move(Math.min(8, Math.max(1, shown.length - 1 - active)));
    else if (e.key === 'PageUp') move(-Math.min(8, active));
    else if (e.key === 'Enter') runAt(active);
    else if (e.key === 'Escape') close();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // Keep focus in the input while clicking items, so the bar doesn't close first.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target && e.target.closest ? e.target.closest('.cmdbar-item') : null;
    if (li) runAt(Number(li.dataset.index));
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target && e.target.closest ? e.target.closest('.cmdbar-item') : null;
    if (!li) return;
    const i = Number(li.dataset.index);
    if (i !== active) {
      active = i;
      render();
    }
  });

  // Clicking or tabbing anywhere else closes it.
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!bar.hidden && doc.activeElement !== input) close({ restore: false });
    }, 0);
  });

  return {
    open,
    close,
    isOpen: () => !bar.hidden,
    element: bar,
  };
}
