// OWNER: Worker 3. Pure helpers for rendering chat messages. No DOM, no window.proxy,
// so they can be unit-tested with `node --test`.

/** @typedef {import('../../shared/contracts.js').Message} Message */
/** @typedef {import('../../shared/contracts.js').ImageData} ImageData */

/**
 * `data:` URL for an ImageData, for use as an <img src>. The CSP allows data: images only.
 * @param {ImageData} image
 */
export function imageToDataUrl(image) {
  const mime = image && image.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${(image && image.dataBase64) || ''}`;
}

/**
 * Turn a data: URL (from FileReader / paste) back into ImageData.
 * Returns null if it isn't a PNG or JPEG data URL.
 * @param {string} dataUrl
 * @returns {ImageData|null}
 */
export function dataUrlToImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mimeType: /** @type {'image/png'|'image/jpeg'} */ (m[1]), dataBase64: m[2] };
}

/**
 * The parts of an assistant reply to show, in order. Only sections with content
 * are returned. Each one gets its own Copy button.
 * The provider already enforces the answer style when it replies, so this shows
 * whatever the stored message has: old replies keep the style they were made with.
 * @param {Message} message
 * @returns {{ key: 'answer'|'explanation', label: string, text: string }[]}
 */
export function replySections(message) {
  if (!message || message.role !== 'assistant' || message.error) return [];
  const out = [];
  const answer = typeof message.answer === 'string' ? message.answer.trim() : '';
  const explanation = typeof message.explanation === 'string' ? message.explanation.trim() : '';
  if (answer) out.push({ key: 'answer', label: 'Answer', text: answer });
  if (explanation) out.push({ key: 'explanation', label: 'Explanation', text: explanation });
  return out;
}

/**
 * Kind of bubble to render for a message.
 * @param {Message & { pending?: boolean }} message
 * @returns {'user'|'assistant'|'error'|'stopped'|'pending'|'empty'}
 */
export function bubbleKind(message) {
  if (!message) return 'empty';
  if (message.pending) return 'pending';
  if (message.role === 'user') return 'user';
  if (message.error) return 'error';
  if (message.stopped) return 'stopped';
  return replySections(message).length ? 'assistant' : 'empty';
}

/**
 * Short label for a session in the list: "14:05" today, "Nov 3" this year, else "2025-11-03".
 * @param {number} ms
 * @param {number} [now]
 */
export function formatSessionTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const pad = (x) => String(x).padStart(2, '0');
  if (d.toDateString() === n.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (d.getFullYear() === n.getFullYear()) return `${months[d.getMonth()]} ${d.getDate()}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
