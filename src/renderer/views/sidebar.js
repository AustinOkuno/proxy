// OWNER: Worker 3. Session list with folders.
// - Chats: click to open; rename with double-click, F2 or the pencil; delete (click twice to confirm).
// - Folders: click to collapse/expand; rename the same way; delete (click twice; chats move out).
// - Drag a chat onto a folder to file it, or onto empty list space to take it out of its folder.

import { el } from './dom.js';
import { formatSessionTime } from '../lib/messages.js';
import { groupSessions, isUsefulMove } from '../lib/folders.js';

const CONFIRM_MS = 3000;

/**
 * @param {HTMLUListElement} list
 * @param {HTMLElement} emptyNote
 * @param {{
 *   onOpen: (id: string) => void,
 *   onRename: (id: string, title: string) => Promise<unknown>,
 *   onDelete: (id: string) => Promise<unknown>,
 *   onMove: (id: string, folderId: string|null) => Promise<unknown>,
 *   onCreateFolder: () => Promise<{ id: string, name: string }|undefined>,
 *   onUpdateFolder: (id: string, patch: { name?: string, collapsed?: boolean }) => Promise<unknown>,
 *   onDeleteFolder: (id: string) => Promise<unknown>,
 * }} handlers
 */
export function createSidebar(list, emptyNote, handlers) {
  const { onOpen, onRename, onDelete, onMove, onCreateFolder, onUpdateFolder, onDeleteFolder } = handlers;
  let sessions = [];
  let folders = [];
  let currentId = null;
  /** @type {{ kind: 'session'|'folder', id: string }|null} */
  let editing = null;
  /** @type {{ kind: 'session'|'folder', id: string }|null} */
  let confirming = null;
  let confirmTimer = null;
  /** Chat id being dragged. */
  let dragId = null;

  const is = (ref, kind, id) => !!ref && ref.kind === kind && ref.id === id;

  function startEdit(kind, id) {
    editing = { kind, id };
    confirming = null;
    render();
  }

  // ---- shared bits -------------------------------------------------------

  function renameInput(value, label, save) {
    const input = el('input', { type: 'text', className: 'rename-input', value, 'aria-label': label });
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      editing = null;
      if (commit && next && next !== value) {
        try {
          await save(next);
        } catch {
          /* the list re-renders from history:changed; nothing else to do */
        }
      }
      render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }

  function renameButton(kind, id, label) {
    const b = el('button', { type: 'button', className: 'btn icon small', title: `Rename (F2 or double-click)`, 'aria-label': label, text: '✎' });
    b.addEventListener('click', () => startEdit(kind, id));
    return b;
  }

  function deleteButton(kind, id, { label, confirmTitle, run }) {
    const armed = is(confirming, kind, id);
    const b = el('button', {
      type: 'button',
      className: `btn small ${armed ? 'danger' : 'icon'}`,
      title: armed ? confirmTitle : 'Delete',
      'aria-label': armed ? 'Confirm delete' : label,
      text: armed ? 'Delete?' : '🗑',
    });
    b.addEventListener('click', async () => {
      if (!armed) {
        confirming = { kind, id };
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => { confirming = null; render(); }, CONFIRM_MS);
        render();
        return;
      }
      confirming = null;
      clearTimeout(confirmTimer);
      await run();
    });
    return b;
  }

  // ---- drag and drop -----------------------------------------------------

  function clearDropMarks() {
    for (const n of list.querySelectorAll('.drop-target')) n.classList.remove('drop-target');
    list.classList.remove('drop-target-root');
  }

  async function dropOn(folderId) {
    const id = dragId;
    endDrag();
    if (!id || !isUsefulMove(sessions, id, folderId)) return;
    // Show the move right away; history:changed brings the saved state.
    sessions = sessions.map((s) => (s.id === id ? { ...s, folderId } : s));
    render();
    await onMove(id, folderId);
  }

  function endDrag() {
    dragId = null;
    list.classList.remove('dragging');
    for (const n of list.querySelectorAll('.drag-source')) n.classList.remove('drag-source');
    clearDropMarks();
  }

  /** Make `node` a drop zone for folder `folderId`. */
  function makeFolderDropZone(node, folderId) {
    node.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (!node.classList.contains('drop-target')) {
        clearDropMarks();
        node.classList.add('drop-target');
      }
    });
    node.addEventListener('dragleave', (e) => {
      if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
    });
    node.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      dropOn(folderId);
    });
  }

  // The list itself (anywhere outside a folder) means "top level".
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    if (!isUsefulMove(sessions, dragId, null)) { clearDropMarks(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!list.classList.contains('drop-target-root')) {
      clearDropMarks();
      list.classList.add('drop-target-root');
    }
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) list.classList.remove('drop-target-root');
  });
  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    dropOn(null);
  });

  // ---- rows --------------------------------------------------------------

  function sessionRow(s) {
    if (is(editing, 'session', s.id)) {
      const input = renameInput(s.title, 'Chat title', (title) => onRename(s.id, title));
      return el('li', { className: 'session editing' }, [input]);
    }
    const open = el('button', { type: 'button', className: 'session-open', title: `${s.title}\nDouble-click or F2 to rename. Drag onto a folder to file it.` }, [
      el('span', { className: 'session-title', text: s.title || 'Untitled' }),
      el('span', { className: 'session-time muted', text: formatSessionTime(s.updatedAt) }),
    ]);
    open.addEventListener('click', () => onOpen(s.id));
    open.addEventListener('dblclick', (e) => { e.preventDefault(); startEdit('session', s.id); });
    open.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); startEdit('session', s.id); }
    });
    const del = deleteButton('session', s.id, {
      label: 'Delete chat',
      confirmTitle: 'Click again to delete',
      run: () => onDelete(s.id),
    });
    const li = el('li', {
      className: `session${s.id === currentId ? ' current' : ''}`,
      draggable: 'true',
      dataset: { id: s.id },
    }, [open, renameButton('session', s.id, 'Rename chat'), del]);
    li.addEventListener('dragstart', (e) => {
      dragId = s.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', s.title || s.id);
      li.classList.add('drag-source');
      list.classList.add('dragging');
    });
    li.addEventListener('dragend', endDrag);
    return li;
  }

  /** The last folder open/close click, so a double-click (rename) can undo it. */
  let lastToggle = null;

  function setCollapsed(folder, collapsed) {
    if (!!folder.collapsed === collapsed) return;
    folder.collapsed = collapsed;
    render();
    onUpdateFolder(folder.id, { collapsed });
  }

  function folderRow({ folder, sessions: inside }) {
    const collapsed = !!folder.collapsed;
    let head;
    if (is(editing, 'folder', folder.id)) {
      const input = renameInput(folder.name, 'Folder name', (name) => onUpdateFolder(folder.id, { name }));
      head = el('div', { className: 'folder-head editing' }, [input]);
    } else {
      const toggle = el('button', {
        type: 'button',
        className: 'folder-toggle',
        'aria-expanded': String(!collapsed),
        title: `${folder.name}\nClick to ${collapsed ? 'open' : 'close'}. Double-click or F2 to rename.`,
      }, [
        el('span', { className: 'folder-caret', 'aria-hidden': 'true', text: collapsed ? '▸' : '▾' }),
        el('span', { className: 'folder-name', text: folder.name }),
        el('span', { className: 'folder-count muted', text: String(inside.length) }),
      ]);
      toggle.addEventListener('click', (e) => {
        if (e.detail > 1) return; // second click of a double-click: the dblclick handler takes it
        lastToggle = { id: folder.id, from: collapsed };
        setCollapsed(folder, !collapsed);
      });
      toggle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        // Double-click renames: put back what the first click toggled.
        if (lastToggle && lastToggle.id === folder.id) setCollapsed(folder, lastToggle.from);
        lastToggle = null;
        startEdit('folder', folder.id);
      });
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'F2') { e.preventDefault(); startEdit('folder', folder.id); }
      });
      const del = deleteButton('folder', folder.id, {
        label: 'Delete folder',
        confirmTitle: 'Click again to delete the folder. Its chats are kept and move out of it.',
        run: () => onDeleteFolder(folder.id),
      });
      head = el('div', { className: 'folder-head' }, [toggle, renameButton('folder', folder.id, 'Rename folder'), del]);
    }

    const children = [head];
    if (!collapsed) {
      children.push(el('ul', { className: 'folder-items' },
        inside.length
          ? inside.map(sessionRow)
          : [el('li', { className: 'folder-empty muted', text: 'Drag chats here' })]));
    }
    const li = el('li', { className: `folder${collapsed ? ' collapsed' : ''}`, dataset: { folderId: folder.id } }, children);
    makeFolderDropZone(li, folder.id);
    return li;
  }

  function render() {
    const { groups, loose } = groupSessions(sessions, folders);
    const rows = groups.map(folderRow);
    if (groups.length && loose.length) rows.push(el('li', { className: 'list-label muted', text: 'Chats' }));
    rows.push(...loose.map(sessionRow));
    list.replaceChildren(...rows);
    emptyNote.hidden = sessions.length > 0 || folders.length > 0;
  }

  function stillExists(ref) {
    if (!ref) return false;
    return ref.kind === 'folder' ? folders.some((f) => f.id === ref.id) : sessions.some((s) => s.id === ref.id);
  }

  return {
    /**
     * @param {object[]} nextSessions  SessionSummary[] newest first
     * @param {object[]} [nextFolders] Folder[]
     */
    setData(nextSessions, nextFolders = folders) {
      sessions = Array.isArray(nextSessions) ? nextSessions : [];
      folders = Array.isArray(nextFolders) ? nextFolders.map((f) => ({ ...f })) : [];
      if (editing && !stillExists(editing)) editing = null;
      // Don't yank the rename box away while someone is typing, or rows out from under a drag.
      if (!editing && !dragId) render();
    },
    setCurrent(id) {
      if (id === currentId) return;
      currentId = id;
      if (!editing && !dragId) render();
    },
    /** Create a folder and put its name straight into rename mode. */
    async newFolder() {
      const f = await onCreateFolder();
      if (!f || !f.id) return;
      if (!folders.some((x) => x.id === f.id)) folders = [...folders, { ...f }];
      startEdit('folder', f.id);
    },
  };
}
