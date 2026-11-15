// OWNER: Worker 1 (UI phase). Fuzzy matching for the command bar. Pure, no DOM.

/**
 * Score how well `query` matches `text`: every query character must appear in
 * order. Matches at the start of a word and runs of consecutive characters
 * score higher; null means no match. Case-insensitive; spaces in the query
 * are ignored.
 * @param {string} query
 * @param {string} text
 * @returns {number|null}
 */
export function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, '');
  const t = String(text || '').toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    let s = 1;
    if (found === prev + 1) s += 4; // consecutive
    const before = found === 0 ? ' ' : t[found - 1];
    if (/[\s.:/_-]/.test(before)) s += 6; // start of a word
    if (found === 0) s += 2;
    s -= Math.min(3, (found - ti) * 0.1); // small gap penalty
    score += s;
    prev = found;
    ti = found + 1;
  }
  // A whole-word substring match beats a scattered one.
  if (t.includes(String(query).toLowerCase().trim())) score += 10;
  return score;
}

/**
 * Filter and sort items by how well they match `query`. Each item is matched
 * on its title first, then on "group title id". Ties keep the input order.
 * @template {{ title: string, group?: string, id?: string }} T
 * @param {string} query
 * @param {T[]} items
 * @returns {T[]}
 */
export function filterItems(query, items) {
  if (!String(query || '').trim()) return items.slice();
  const scored = [];
  items.forEach((item, index) => {
    const title = fuzzyScore(query, item.title);
    const all = fuzzyScore(query, `${item.group || ''} ${item.title} ${item.id || ''}`);
    const best = title !== null ? title + 5 : all;
    if (best !== null) scored.push({ item, index, score: best });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}
