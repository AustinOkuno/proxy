// OWNER: Worker 2 (UI phase). Pure helpers for the folder sidebar (no DOM, unit-tested).

/**
 * Pinned items first (most recently pinned first); the rest keep their
 * incoming order. Stable.
 * @template {{ pinned?: boolean, pinnedAt?: number|null }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function pinnedFirst(items = []) {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const pa = !!(a.item && a.item.pinned);
      const pb = !!(b.item && b.item.pinned);
      if (pa !== pb) return pa ? -1 : 1;
      if (pa) return ((b.item.pinnedAt || 0) - (a.item.pinnedAt || 0)) || a.i - b.i;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * Split sessions into folders and loose top-level chats, in sidebar order
 * (SPEC 9.5.5): pinned folders (latest pin first), other folders (creation
 * order), then pinned chats, then other chats (newest first, the incoming
 * order). Inside a folder, pinned chats come first. A chat whose folderId
 * names a folder that doesn't exist is shown at the top level.
 *
 * @param {object[]} sessions  SessionSummary[]
 * @param {object[]} folders   Folder[]
 * @returns {{ groups: { folder: object, sessions: object[] }[], loose: object[] }}
 */
export function groupSessions(sessions = [], folders = []) {
  const groups = pinnedFirst(folders).map((folder) => ({ folder, sessions: [] }));
  const byId = new Map(groups.map((g) => [g.folder.id, g]));
  const loose = [];
  for (const s of sessions) {
    const g = s && s.folderId ? byId.get(s.folderId) : null;
    if (g) g.sessions.push(s);
    else loose.push(s);
  }
  for (const g of groups) g.sessions = pinnedFirst(g.sessions);
  return { groups, loose: pinnedFirst(loose) };
}

/**
 * Chat ids in the order the sidebar shows them (folders first, collapsed or
 * not), for Ctrl+Tab / Ctrl+Shift+Tab.
 */
export function sidebarOrder(sessions = [], folders = []) {
  const { groups, loose } = groupSessions(sessions, folders);
  return [...groups.flatMap((g) => g.sessions), ...loose].map((s) => s.id);
}

/**
 * The chat `step` places after `currentId` in sidebar order, wrapping around.
 * With no current chat, +1 gives the first and -1 the last.
 * @returns {string|null}
 */
export function stepChat(order, currentId, step) {
  if (!order.length) return null;
  const i = order.indexOf(currentId);
  if (i < 0) return step >= 0 ? order[0] : order[order.length - 1];
  return order[(((i + step) % order.length) + order.length) % order.length];
}

/**
 * Split a search hit's snippet around its match, for highlighting.
 * @param {{ snippet: string, matchStart: number, matchLength: number }} hit
 * @returns {{ before: string, match: string, after: string }}
 */
export function splitSnippet(hit) {
  const text = String((hit && hit.snippet) || '');
  const start = Math.max(0, Math.min(text.length, Number(hit && hit.matchStart) || 0));
  const end = Math.max(start, Math.min(text.length, start + (Number(hit && hit.matchLength) || 0)));
  return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
}

/**
 * Whether dropping chat `sessionId` onto `folderId` (null = top level) would change anything.
 * @param {object[]} sessions
 * @param {string|null} sessionId
 * @param {string|null} folderId
 */
export function isUsefulMove(sessions, sessionId, folderId) {
  const s = (sessions || []).find((x) => x.id === sessionId);
  if (!s) return false;
  return (s.folderId || null) !== (folderId || null);
}
