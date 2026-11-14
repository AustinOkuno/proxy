// OWNER: Worker 3. Pure helpers for the folder sidebar (no DOM, unit-tested).

/**
 * Split sessions into folders (in folder order) and loose top-level chats.
 * Chats keep their incoming order (newest first). A chat whose folderId names
 * a folder that doesn't exist is shown at the top level.
 *
 * @param {object[]} sessions  SessionSummary[]
 * @param {object[]} folders   Folder[]
 * @returns {{ groups: { folder: object, sessions: object[] }[], loose: object[] }}
 */
export function groupSessions(sessions = [], folders = []) {
  const groups = folders.map((folder) => ({ folder, sessions: [] }));
  const byId = new Map(groups.map((g) => [g.folder.id, g]));
  const loose = [];
  for (const s of sessions) {
    const g = s && s.folderId ? byId.get(s.folderId) : null;
    if (g) g.sessions.push(s);
    else loose.push(s);
  }
  return { groups, loose };
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
