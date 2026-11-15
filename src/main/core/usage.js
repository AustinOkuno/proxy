'use strict';

/**
 * Usage tracking for the meter (SPEC 9.5.4). Electron-free.
 *
 * Only what each backend really reports is shown:
 * - Claude (Pro): the Claude Code CLI prints `rate_limit_event` lines in its
 *   stream-json output. Current versions list the 5-hour and weekly windows
 *   together in `unifiedWindows`; older ones send one window per event in
 *   `rateLimitType`. We keep the latest report per window (5-hour, weekly).
 *   Nothing is known before the first reply of the session's first run.
 *   Proxy never calls Anthropic to ask.
 * - Gemini: the API has no "quota left" call, so we count requests and tokens
 *   per local day, and after a 429 mark it limited until the retry delay.
 *
 * Stored in dataDir/usage.json; daily counts are kept for 14 days.
 */

const path = require('node:path');
const { PROVIDERS } = require('../../shared/contracts');
const { readJson, writeJsonAtomic, quarantine } = require('./fsutil');

const KEEP_DAYS = 14;
const WARNING_AT = 0.8;
const DEFAULT_LIMITED_MS = 60 * 1000;
const MAX_LIMITED_MS = 24 * 60 * 60 * 1000;

const CLAUDE_WINDOWS = Object.freeze([
  { id: 'five_hour', label: 'Next 5 h' },
  { id: 'seven_day', label: 'This week' },
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Local calendar day, 'YYYY-MM-DD'. */
function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Epoch ms of the next local midnight after `ms`. */
function nextMidnight(ms) {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** Seconds or ms (or an ISO string) -> epoch ms, or null. */
function toMs(v) {
  if (isNum(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n)) return toMs(n);
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

const STATUSES = Object.freeze(['allowed', 'allowed_warning', 'rejected']);
// Windows the CLI may list in rate_limit_info.unifiedWindows. The store keeps
// only the ones in CLAUDE_WINDOWS; the rest are passed on and ignored.
const UNIFIED_WINDOW_IDS = Object.freeze(['five_hour', 'seven_day', 'seven_day_overage_included']);

/**
 * Top-level utilization: a fraction, but some older CLI versions sent a
 * percentage. Current versions can send a little over 1 when usage runs past
 * a window's cap, so only values above 2 are read as percentages.
 */
function readUtilization(v) {
  if (!isNum(v) || v < 0) return null;
  if (v > 2 && v <= 100) return clamp01(v / 100);
  return clamp01(v);
}

/**
 * One entry of rate_limit_info.unifiedWindows (utilization is a fraction that
 * can pass 1, resetsAt is epoch seconds, status is optional).
 * @returns {{ type: string, status: string, resetsAt: number|null, utilization: number|null } | null}
 */
function parseUnifiedWindow(type, w, fallbackStatus) {
  if (!isObj(w)) return null;
  const utilization = readUtilization(w.utilization);
  const resetsAt = toMs(w.resetsAt);
  if (utilization === null && resetsAt === null) return null;
  let status = STATUSES.includes(w.status) ? w.status : fallbackStatus;
  if (!status) status = 'allowed';
  return { type, status, resetsAt, utilization };
}

/**
 * Read one stream-json line from the Claude CLI. Returns the rate limit it
 * reports, or null if it isn't a usable rate_limit_event.
 *
 * Current CLIs send `rate_limit_info.unifiedWindows` with the 5-hour and
 * weekly windows together ({ five_hour: { utilization, resetsAt, status? },
 * seven_day: {...} }), and may leave out `rateLimitType`. Those go in
 * `windows`. The top-level fields (older CLIs, and the window that triggered
 * the event) stay in type/status/resetsAt/utilization; `type` is null when
 * the CLI didn't name one.
 * @param {any} ev  parsed JSON line
 * @returns {{ type: string|null, status: string|null, resetsAt: number|null, utilization: number|null,
 *   windows: Array<{ type: string, status: string, resetsAt: number|null, utilization: number|null }> } | null}
 */
function parseRateLimitEvent(ev) {
  if (!isObj(ev) || ev.type !== 'rate_limit_event') return null;
  const info = isObj(ev.rate_limit_info) ? ev.rate_limit_info : null;
  if (!info) return null;
  const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : null;
  const status = typeof info.status === 'string' ? info.status : null;

  const windows = [];
  if (isObj(info.unifiedWindows)) {
    for (const id of UNIFIED_WINDOW_IDS) {
      // The top-level status belongs to the window that triggered the event.
      const w = parseUnifiedWindow(id, info.unifiedWindows[id], id === type ? status : null);
      if (w) windows.push(w);
    }
  }

  if (!(type && status) && !windows.length) return null;
  return {
    type: type && status ? type : null,
    status,
    resetsAt: toMs(info.resetsAt),
    utilization: readUtilization(info.utilization),
    windows,
  };
}

/** How long Gemini asked us to wait, from a 429 error, in ms (default 60 s). */
function geminiRetryDelayMs(err) {
  const text = String((err && err.message) || '');
  const m = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(text) || /retry in (\d+(?:\.\d+)?)\s*s/i.exec(text);
  const ms = m ? Math.round(Number(m[1]) * 1000) : DEFAULT_LIMITED_MS;
  return Math.max(1000, Math.min(MAX_LIMITED_MS, ms));
}

function statusFrom(cliStatus, used) {
  if (cliStatus === 'rejected') return 'limited';
  if (cliStatus === 'allowed_warning') return 'warning';
  if (used !== null && used >= WARNING_AT) return 'warning';
  return 'ok';
}

function emptyState() {
  return { version: 1, days: {}, claude: {}, limitedUntil: {} };
}

/** Keep only well-formed parts of a loaded usage.json. */
function cleanState(raw) {
  const s = emptyState();
  if (!isObj(raw)) return s;
  if (isObj(raw.days)) {
    for (const [day, perProvider] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isObj(perProvider)) continue;
      for (const [p, c] of Object.entries(perProvider)) {
        if (!Object.values(PROVIDERS).includes(p) || !isObj(c)) continue;
        (s.days[day] ||= {})[p] = {
          requests: isNum(c.requests) ? Math.max(0, Math.floor(c.requests)) : 0,
          inputTokens: isNum(c.inputTokens) ? Math.max(0, Math.floor(c.inputTokens)) : 0,
          outputTokens: isNum(c.outputTokens) ? Math.max(0, Math.floor(c.outputTokens)) : 0,
        };
      }
    }
  }
  if (isObj(raw.claude)) {
    for (const w of CLAUDE_WINDOWS) {
      const v = raw.claude[w.id];
      if (!isObj(v) || typeof v.status !== 'string') continue;
      s.claude[w.id] = {
        status: v.status,
        resetsAt: isNum(v.resetsAt) ? v.resetsAt : null,
        utilization: isNum(v.utilization) ? clamp01(v.utilization) : null,
        at: isNum(v.at) ? v.at : 0,
      };
    }
  }
  if (isObj(raw.limitedUntil)) {
    for (const [p, t] of Object.entries(raw.limitedUntil)) {
      if (Object.values(PROVIDERS).includes(p) && isNum(t)) s.limitedUntil[p] = t;
    }
  }
  if (isNum(raw.updatedAt)) s.updatedAt = raw.updatedAt;
  return s;
}

/**
 * @param {{ dataDir: string, logger?: Pick<Console,'warn'>, now?: () => number }} opts
 */
function createUsageStore({ dataDir, logger = console, now = Date.now }) {
  const file = path.join(dataDir, 'usage.json');
  let state = emptyState();
  const loaded = readJson(file);
  if (loaded.ok) state = cleanState(loaded.value);
  else if (!loaded.missing) {
    logger.warn(`[core] usage.json unreadable, starting over: ${loaded.error && loaded.error.message}`);
    quarantine(file);
  }
  const listeners = new Set();

  function prune() {
    const cutoff = dayKey(now() - (KEEP_DAYS - 1) * 24 * 60 * 60 * 1000);
    for (const day of Object.keys(state.days)) if (day < cutoff) delete state.days[day];
  }

  function changed() {
    state.updatedAt = now();
    prune();
    try {
      writeJsonAtomic(file, state);
    } catch (err) {
      logger.warn(`[core] could not save usage: ${err.message}`);
    }
    for (const cb of [...listeners]) {
      try { cb(); } catch (err) { logger.warn(`[core] usage listener failed: ${err.message}`); }
    }
  }

  function counts(provider, ms = now()) {
    const day = state.days[dayKey(ms)];
    const c = day && day[provider];
    return { requests: c ? c.requests : 0, inputTokens: c ? c.inputTokens : 0, outputTokens: c ? c.outputTokens : 0 };
  }

  return {
    /** One request sent to a provider (count it even if it failed: it still uses quota). */
    recordRequest(provider, { inputTokens = 0, outputTokens = 0 } = {}) {
      if (!Object.values(PROVIDERS).includes(provider)) return;
      const day = (state.days[dayKey(now())] ||= {});
      const c = (day[provider] ||= { requests: 0, inputTokens: 0, outputTokens: 0 });
      c.requests += 1;
      c.inputTokens += isNum(inputTokens) && inputTokens > 0 ? Math.floor(inputTokens) : 0;
      c.outputTokens += isNum(outputTokens) && outputTokens > 0 ? Math.floor(outputTokens) : 0;
      changed();
    },

    /** Tokens for a request already counted (Claude reports them at the end). */
    addTokens(provider, { inputTokens = 0, outputTokens = 0 } = {}) {
      const day = state.days[dayKey(now())];
      const c = day && day[provider];
      if (!c) return;
      const add = (v) => (isNum(v) && v > 0 ? Math.floor(v) : 0);
      if (!add(inputTokens) && !add(outputTokens)) return;
      c.inputTokens += add(inputTokens);
      c.outputTokens += add(outputTokens);
      changed();
    },

    /**
     * A rate_limit_event from the Claude CLI (already parsed). Records the
     * top-level window and every unifiedWindows entry; unknown window types
     * are ignored. Only the top-level status means requests are refused.
     */
    recordClaudeRateLimit(info) {
      if (!isObj(info)) return;
      const known = (t) => CLAUDE_WINDOWS.some((w) => w.id === t);
      const at = now();
      let touched = false;
      if (known(info.type) && typeof info.status === 'string') {
        const resetsAt = isNum(info.resetsAt) ? info.resetsAt : null;
        const utilization = isNum(info.utilization) ? clamp01(info.utilization) : null;
        state.claude[info.type] = { status: info.status, resetsAt, utilization, at };
        if (info.status === 'rejected' && resetsAt) state.limitedUntil[PROVIDERS.CLAUDE_PRO] = resetsAt;
        touched = true;
      }
      for (const w of Array.isArray(info.windows) ? info.windows : []) {
        if (!isObj(w) || !known(w.type) || typeof w.status !== 'string') continue;
        const prev = w.type === info.type ? state.claude[w.type] : null;
        state.claude[w.type] = {
          status: w.status,
          resetsAt: isNum(w.resetsAt) ? w.resetsAt : (prev ? prev.resetsAt : null),
          utilization: isNum(w.utilization) ? clamp01(w.utilization) : (prev ? prev.utilization : null),
          at,
        };
        touched = true;
      }
      if (touched) changed();
    },

    /** The provider refused for being over its limit; it is limited until `untilMs`. */
    markLimited(provider, untilMs) {
      if (!Object.values(PROVIDERS).includes(provider) || !isNum(untilMs)) return;
      state.limitedUntil[provider] = untilMs;
      changed();
    },

    /**
     * What the meter shows for the current provider.
     * @param {{ provider?: string, usage?: { geminiDailyRequests?: number|null } }} settings
     * @returns {import('../../shared/contracts').UsageSnapshot}
     */
    snapshot(settings = {}) {
      const t = now();
      const provider = settings.provider === PROVIDERS.CLAUDE_PRO ? PROVIDERS.CLAUDE_PRO : PROVIDERS.GEMINI;
      const today = counts(provider, t);
      const limitedUntil = state.limitedUntil[provider];
      const limitedNow = isNum(limitedUntil) && limitedUntil > t;

      if (provider === PROVIDERS.CLAUDE_PRO) {
        const windows = CLAUDE_WINDOWS.map(({ id, label }) => {
          const w = state.claude[id];
          // Nothing reported yet, or the window has reset since: unknown.
          if (!w || (w.resetsAt !== null && w.resetsAt <= t)) {
            return { id, label, used: null, resetsAt: null, status: 'unknown' };
          }
          return { id, label, used: w.utilization, resetsAt: w.resetsAt, status: statusFrom(w.status, w.utilization) };
        });
        const ats = CLAUDE_WINDOWS.map(({ id }) => state.claude[id] && state.claude[id].at).filter(isNum);
        return { provider, source: 'claude-cli', windows, today, updatedAt: ats.length ? Math.max(...ats) : null };
      }

      const budget = settings.usage && isNum(settings.usage.geminiDailyRequests) ? settings.usage.geminiDailyRequests : null;
      const used = budget ? clamp01(today.requests / budget) : null;
      let status = 'ok';
      // Only a real 429 means limited; the budget is the user's own target.
      if (limitedNow) status = 'limited';
      else if (used !== null && used >= WARNING_AT) status = 'warning';
      const day = {
        id: 'day',
        label: 'Today',
        used,
        resetsAt: limitedNow ? limitedUntil : nextMidnight(t),
        status,
      };
      const d = state.days[dayKey(t)];
      const hasToday = !!(d && d[provider]);
      return { provider, source: 'local-count', windows: [day], today, updatedAt: hasToday || limitedNow ? state.updatedAt || null : null };
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

module.exports = { createUsageStore, parseRateLimitEvent, geminiRetryDelayMs, dayKey, nextMidnight, CLAUDE_WINDOWS };
