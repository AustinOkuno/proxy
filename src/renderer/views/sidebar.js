// OWNER: Worker 3. Session list: open, rename (inline), delete (click twice to confirm).

import { el } from './dom.js';
import { formatSessionTime } from '../lib/messages.js';

/**
 * @param {HTMLUListElement} list
 * @param {HTMLElement} emptyNote
 * @param {{
 *   onOpen: (id: string) => void,
 *   onRename: (id: string, title: string) => Promise<unknown>,
 *   onDelete: (id: string) => Promise<unknown>,
 * }} handlers
 */
export function createSidebar(list, emptyNote, { onOpen, onRename, onDelete }) {
  let sessions = [];
  let currentId = null;
  let editingId = null;
  let confirmDeleteId = null;
  let confirmTimer = null;

  function renameRow(s) {
    const input = el('input', { type: 'text', className: 'rename-input', value: s.title, 'aria-label': 'Chat title' });
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      editingId = null;
      if (save && title && title !== s.title) {
        try {
          await onRename(s.id, title);
        } catch {
          /* list re-renders from history:changed; nothing else to do */
        }
      }
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    queueMicrotask(() => { input.focus(); input.select(); });
    return el('li', { className: 'session editing' }, [input]);
  }

  function row(s) {
    if (s.id === editingId) return renameRow(s);
    const confirming = s.id === confirmDeleteId;
    const open = el('button', { type: 'button', className: 'session-open', title: s.title }, [
      el('span', { className: 'session-title', text: s.title || 'Untitled' }),
      el('span', { className: 'session-time muted', text: formatSessionTime(s.updatedAt) }),
    ]);
    open.addEventListener('click', () => onOpen(s.id));
    const rename = el('button', { type: 'button', className: 'btn icon small', title: 'Rename', 'aria-label': 'Rename chat', text: '✎' });
    rename.addEventListener('click', () => {
      editingId = s.id;
      confirmDeleteId = null;
      render();
    });
    const del = el('button', {
      type: 'button',
      className: `btn small ${confirming ? 'danger' : 'icon'}`,
      title: confirming ? 'Click again to delete' : 'Delete',
      'aria-label': confirming ? 'Confirm delete' : 'Delete chat',
      text: confirming ? 'Delete?' : '🗑',
    });
    del.addEventListener('click', async () => {
      if (!confirming) {
        confirmDeleteId = s.id;
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { confirmDeleteId = null; render(); }, 3000);
        render();
        return;
      }
      confirmDeleteId = null;
      clearTimeout(confirmTimer);
      await onDelete(s.id);
    });
    return el('li', { className: `session${s.id === currentId ? ' current' : ''}` }, [open, rename, del]);
  }

  function render() {
    list.replaceChildren(...sessions.map(row));
    emptyNote.hidden = sessions.length > 0;
  }

  return {
    /** @param {object[]} next SessionSummary[] newest first */
    setSessions(next) {
      sessions = Array.isArray(next) ? next : [];
      if (editingId && !sessions.some((s) => s.id === editingId)) editingId = null;
      // Don't yank the rename box away while someone is typing in it.
      if (!editingId) render();
    },
    setCurrent(id) {
      if (id === currentId) return;
      currentId = id;
      if (!editingId) render();
    },
  };
}
