// OWNER: Worker 2 (UI phase). Session list with folders, pins and search (SPEC 9.2 #9).
// - Chats: click to open; rename with double-click, F2 or the pencil; pin; delete (click twice to confirm).
// - Folders: click to collapse/expand; rename the same way; pin; delete (click twice; chats move out).
// - Drag a chat onto a folder to file it, or onto empty list space to take it out of its folder.
// - Pinned folders sit at the top, then other folders, pinned chats and the rest.
// - Ctrl+F searches every chat; Ctrl+P lists chats by name; Ctrl+Tab / Ctrl+Shift+Tab step
//   through chats; Ctrl+Shift+P pins the open chat (commands registered below, keys from W1's keymap).

import { el } from './dom.js';
import { formatSessionTime } from '../lib/messages.js';
import { groupSessions, isUsefulMove, sidebarOrder, stepChat, splitSnippet } from '../lib/folders.js';
import { registerCommand } from '../keys/index.js';
import { focusMessage } from './chat.js';

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
  const proxy = typeof window !== 'undefined' ? window.proxy : null;
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

  function pinButton(pinned, label, run) {
    const b = el('button', {
      type: 'button',
      className: `btn icon small pin${pinned ? ' is-pinned' : ''}`,
      title: pinned ? `Unpin ${label}` : `Pin ${label} to the top`,
      'aria-label': pinned ? `Unpin ${label}` : `Pin ${label}`,
      'aria-pressed': String(!!pinned),
      text: pinned ? '★' : '☆',
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      run(!pinned);
    });
    return b;
  }

  async function pinSession(id, pinned) {
    if (!proxy) return;
    // Show it right away; history:changed brings the saved order.
    sessions = sessions.map((s) => (s.id === id ? { ...s, pinned, pinnedAt: pinned ? Date.now() : null } : s));
    render();
    try {
      await proxy.history.setPinned(id, pinned);
    } catch (err) {
      console.warn('[sidebar] pin failed:', err);
    }
  }

  function pinFolder(folder, pinned) {
    folder.pinned = pinned;
    folder.pinnedAt = pinned ? Date.now() : null;
    render();
    onUpdateFolder(folder.id, { pinned });
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
    const pin = pinButton(!!s.pinned, 'chat', (next) => pinSession(s.id, next));
    const li = el('li', {
      className: `session${s.id === currentId ? ' current' : ''}${s.pinned ? ' is-pinned' : ''}`,
      draggable: 'true',
      dataset: { id: s.id },
    }, [open, pin, renameButton('session', s.id, 'Rename chat'), del]);
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
      const pin = pinButton(!!folder.pinned, 'folder', (next) => pinFolder(folder, next));
      head = el('div', { className: 'folder-head' }, [toggle, pin, renameButton('folder', folder.id, 'Rename folder'), del]);
    }

    const children = [head];
    if (!collapsed) {
      children.push(el('ul', { className: 'folder-items' },
        inside.length
          ? inside.map(sessionRow)
          : [el('li', { className: 'folder-empty muted', text: 'Drag chats here' })]));
    }
    const li = el('li', { className: `folder${collapsed ? ' collapsed' : ''}${folder.pinned ? ' is-pinned' : ''}`, dataset: { folderId: folder.id } }, children);
    makeFolderDropZone(li, folder.id);
    return li;
  }

  function render() {
    const { groups, loose } = groupSessions(sessions, folders);
    const rows = groups.map(folderRow);
    const pinned = loose.filter((s) => s.pinned);
    const rest = loose.filter((s) => !s.pinned);
    if (pinned.length) {
      rows.push(el('li', { className: 'list-label muted', text: 'Pinned' }));
      rows.push(...pinned.map(sessionRow));
    }
    if ((groups.length || pinned.length) && rest.length) rows.push(el('li', { className: 'list-label muted', text: 'Chats' }));
    rows.push(...rest.map(sessionRow));
    list.replaceChildren(...rows);
    emptyNote.hidden = sessions.length > 0 || folders.length > 0;
  }

  // ---- search (Ctrl+F) and switching chats (Ctrl+P) ----------------------

  const search = createSearchBox({
    host: (list.closest && list.closest('#app')) || document.body,
    proxy,
    chats: () => {
      const order = sidebarOrder(sessions, folders);
      const byId = new Map(sessions.map((x) => [x.id, x]));
      return order.map((id) => byId.get(id)).filter(Boolean);
    },
    open: (hit) => {
      onOpen(hit.sessionId);
      if (hit.messageId) focusMessage(hit.messageId);
    },
  });

  function openRelative(step) {
    const next = stepChat(sidebarOrder(sessions, folders), currentId, step);
    if (next && next !== currentId) onOpen(next);
  }

  registerCommand({ id: 'history.search', title: 'Search all chats', group: 'Chats', run: () => search.show('search') });
  registerCommand({ id: 'chat.switch', title: 'Switch to a chat by name', group: 'Chats', run: () => search.show('switch') });
  registerCommand({ id: 'chat.next', title: 'Next chat', group: 'Chats', run: () => openRelative(1) });
  registerCommand({ id: 'chat.prev', title: 'Previous chat', group: 'Chats', run: () => openRelative(-1) });
  registerCommand({
    id: 'history.pinCurrent',
    title: 'Pin or unpin the open chat',
    group: 'Chats',
    when: () => !!currentId,
    run: () => {
      const s = sessions.find((x) => x.id === currentId);
      if (s) return pinSession(s.id, !s.pinned);
      return undefined;
    },
  });

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

// ---------------------------------------------------------------------------
// Search box: one overlay for full-text search (Ctrl+F) and switching chats
// by name (Ctrl+P). Empty query lists chats in sidebar order; typing searches
// titles, questions, answers and explanations in the main process.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 120;

function createSearchBox({ host, proxy, chats, open }) {
  const input = el('input', {
    type: 'search',
    className: 'search-input',
    placeholder: 'Search all chats',
    'aria-label': 'Search all chats',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const results = el('ul', { className: 'search-results', role: 'listbox' });
  const status = el('div', { className: 'search-status muted', 'aria-live': 'polite' });
  const box = el('div', { className: 'search-box', role: 'dialog', 'aria-label': 'Search', hidden: true }, [input, status, results]);
  host.append(box);

  /** @type {{ sessionId: string, messageId: string|null, title: string, snippet?: string, matchStart?: number, matchLength?: number }[]} */
  let items = [];
  let active = 0;
  let timer = null;
  let seq = 0;

  function draw() {
    results.replaceChildren(...items.map((hit, i) => {
      const parts = hit.snippet != null ? splitSnippet(hit) : null;
      const li = el('li', {
        className: `search-hit${i === active ? ' active' : ''}`,
        role: 'option',
        'aria-selected': String(i === active),
      }, [
        el('div', { className: 'search-hit-title', text: hit.title || 'Untitled' }),
        parts && hit.messageId
          ? el('div', { className: 'search-hit-snippet muted' }, [
            parts.before, el('mark', { className: 'search-mark', text: parts.match }), parts.after,
          ])
          : null,
      ]);
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => choose(i));
      return li;
    }));
    const cur = results.children[active];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function listChats(filter = '') {
    const f = filter.toLowerCase();
    items = chats()
      .filter((s) => !f || String(s.title || '').toLowerCase().includes(f))
      .map((s) => ({ sessionId: s.id, messageId: null, title: s.title }));
    active = 0;
    status.textContent = items.length ? '' : 'No chats yet';
    draw();
  }

  async function runSearch(query) {
    const mine = ++seq;
    if (!query.trim()) { listChats(); return; }
    if (!proxy) return;
    try {
      const hits = await proxy.history.search(query, { limit: 50 });
      if (mine !== seq) return;
      items = Array.isArray(hits) ? hits : [];
      active = 0;
      status.textContent = items.length ? '' : 'Nothing found';
      draw();
    } catch (err) {
      if (mine !== seq) return;
      items = [];
      status.textContent = `Search failed: ${(err && err.message) || err}`;
      draw();
    }
  }

  function choose(i) {
    const hit = items[i];
    if (!hit) return;
    hide();
    open(hit);
  }

  function hide() {
    box.hidden = true;
    clearTimeout(timer);
    seq += 1;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value;
    if (box.dataset.mode === 'switch') { listChats(q); return; }
    timer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  });
  input.addEventListener('blur', () => {
    // Clicking elsewhere closes it (result clicks keep focus via mousedown).
    setTimeout(() => { if (typeof document !== 'undefined' && document.activeElement !== input) hide(); }, 0);
  });

  return {
    /** @param {'search'|'switch'} mode */
    show(mode = 'search') {
      box.dataset.mode = mode;
      const label = mode === 'switch' ? 'Switch to a chat' : 'Search all chats';
      input.placeholder = label;
      input.setAttribute('aria-label', label);
      box.hidden = false;
      input.value = '';
      listChats();
      input.focus();
    },
    hide,
  };
}
