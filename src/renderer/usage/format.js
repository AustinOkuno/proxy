// OWNER: Worker 2. Pure helpers for the usage meter (no DOM, unit-tested).

/** @typedef {import('../../shared/contracts.js').UsageSnapshot} UsageSnapshot */

const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 0.423 -> "42%"; null -> "?" */
export function formatPercent(used) {
  if (typeof used !== 'number' || !Number.isFinite(used)) return '?';
  return `${Math.round(Math.max(0, Math.min(1, used)) * 100)}%`;
}

/**
 * When a window resets, short: "in 25 min", "in 2 h 5 min", "at 14:30" (today),
 * "Mon 09:00" (within a week), or a date.
 * @param {number|null} ms
 * @param {number} [now]
 */
export function formatReset(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const diff = ms - now;
  if (diff <= 0) return 'now';
  const min = Math.ceil(diff / 60000);
  if (min < 60) return `in ${min} min`;
  if (min < 6 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  const d = new Date(ms);
  const n = new Date(now);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return `at ${time}`;
  if (diff < 7 * 24 * 3600 * 1000) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SHORT = { five_hour: '5h', seven_day: 'wk', day: 'today' };

/**
 * What the title bar meter shows. Never claims more than the snapshot knows.
 * @param {UsageSnapshot|null} snap
 * @param {{ usage?: { geminiDailyRequests?: number|null } }} [settings]
 * @param {number} [now]
 * @returns {{ note: string, bars: { id: string, short: string, text: string, used: number|null, status: string }[], title: string }}
 */
export function meterModel(snap, settings = {}, now = Date.now()) {
  if (!snap || !Array.isArray(snap.windows)) {
    return { note: 'Usage unknown', bars: [], title: 'Usage is not available yet.' };
  }
  const lines = [];
  if (snap.source === 'claude-cli') {
    lines.push('Claude (Pro) limits, as reported by the Claude Code CLI after each reply.');
    const known = snap.windows.some((w) => w.status !== 'unknown');
    if (!known) {
      return {
        note: 'Usage shows after your first reply',
        bars: [],
        title: `${lines[0]}\nNothing is known until the first reply of this session.`,
      };
    }
    const bars = snap.windows.map((w) => {
      const reset = formatReset(w.resetsAt, now);
      let text;
      if (w.status === 'unknown') text = '?';
      else if (w.used !== null) text = formatPercent(w.used);
      else text = w.status === 'limited' ? 'limit' : w.status === 'warning' ? 'near' : 'ok';
      const detail = w.status === 'unknown'
        ? `${w.label}: not reported yet`
        : `${w.label}: ${w.used !== null ? `${formatPercent(w.used)} used` : statusWord(w.status)}${reset ? `, resets ${reset}` : ''}`;
      lines.push(detail);
      return { id: w.id, short: SHORT[w.id] || w.id, text, used: w.used, status: w.status };
    });
    return { note: '', bars, title: lines.join('\n') };
  }

  // Gemini: a local count, against the user's own daily budget if they set one.
  const w = snap.windows[0] || { id: 'day', label: 'Today', used: null, resetsAt: null, status: 'ok' };
  const requests = (snap.today && snap.today.requests) || 0;
  const budget = settings.usage && Number.isFinite(settings.usage.geminiDailyRequests) ? settings.usage.geminiDailyRequests : null;
  const text = budget ? `${requests}/${budget}` : `${requests} req`;
  lines.push('Gemini requests sent from Proxy today (counted on this computer; Gemini has no "quota left" API).');
  lines.push(budget ? `${requests} of your daily budget of ${budget}` : `${requests} today. Set a daily budget in Settings > Usage to see a bar.`);
  if (snap.today) lines.push(`Tokens today: ${snap.today.inputTokens} in, ${snap.today.outputTokens} out`);
  if (w.status === 'limited') lines.push(`Gemini said to wait: limited until ${formatReset(w.resetsAt, now).replace(/^in /, 'about ')}`);
  return {
    note: '',
    bars: [{ id: w.id, short: SHORT.day, text: w.status === 'limited' ? 'limit' : text, used: w.used, status: w.status }],
    title: lines.join('\n'),
  };
}

function statusWord(status) {
  return { ok: 'fine', warning: 'close to the limit', limited: 'limit reached' }[status] || 'unknown';
}

/**
 * Parse the budget field: '' -> null (no budget), a whole number in range, or undefined when invalid.
 * @param {string} value
 * @param {{ min: number, max: number }} range
 * @returns {number|null|undefined}
 */
export function parseBudget(value, range) {
  const t = String(value == null ? '' : value).trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= range.min && n <= range.max ? n : undefined;
}
