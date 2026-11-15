// OWNER: Worker 2 (UI phase). Usage meter and the Usage settings tab (SPEC 9.5.4).

import { el } from '../views/dom.js';
import { meterModel, parseBudget, formatReset } from './format.js';

const REFRESH_MS = 60 * 1000; // windows roll over and resets count down even with no new events

/** Live usage snapshot shared by the meter and the settings tab. */
function createUsageFeed(proxy) {
  let snap = null;
  const listeners = new Set();
  const set = (next) => {
    if (!next) return;
    snap = next;
    for (const cb of [...listeners]) cb(snap);
  };
  const refresh = () => proxy.usage.get().then(set, (err) => console.warn('[usage] could not read usage:', err));
  proxy.on(proxy.constants.EVENTS.USAGE_CHANGED, set);
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  if (timer && timer.unref) timer.unref();
  return {
    get: () => snap,
    subscribe(cb) {
      listeners.add(cb);
      if (snap) cb(snap);
      return () => listeners.delete(cb);
    },
  };
}

let feed = null;
const getFeed = (proxy) => (feed ||= createUsageFeed(proxy));

/**
 * The small meter in the title bar.
 * @param {HTMLElement} slot
 * @param {{ proxy: any, settings: object, onSettings: (cb: (s: object) => void) => () => void }} ctx
 */
export function mountUsageMeter(slot, { proxy, settings, onSettings }) {
  if (!slot || !proxy || !proxy.usage) return;
  let current = settings || {};
  const meter = el('div', { className: 'usage-meter no-drag', role: 'status', 'aria-live': 'off' });
  slot.replaceChildren(meter);

  function draw() {
    const snap = getFeed(proxy).get();
    const show = !(current.usage && current.usage.show === false);
    slot.hidden = !show;
    if (!show) return;
    const m = meterModel(snap, current);
    meter.title = m.title;
    meter.setAttribute('aria-label', m.title);
    if (m.note) {
      meter.replaceChildren(el('span', { className: 'usage-note', text: m.note }));
      return;
    }
    meter.replaceChildren(...m.bars.map((b) => {
      const fill = el('span', { className: 'usage-fill' });
      // CSSOM, not a style attribute, so the CSP stays as it is.
      fill.style.width = b.used === null ? '0%' : `${Math.round(b.used * 100)}%`;
      const cls = ['usage-bar', b.status === 'warning' ? 'warning' : '', b.status === 'limited' ? 'limited' : '', b.used === null ? 'no-fill' : '']
        .filter(Boolean).join(' ');
      return el('span', { className: 'usage-item', dataset: { window: b.id } }, [
        el('span', { className: 'usage-label', text: b.short }),
        el('span', { className: cls }, [fill]),
        el('span', { className: 'usage-value', text: b.text }),
      ]);
    }));
  }

  getFeed(proxy).subscribe(draw);
  if (onSettings) onSettings((s) => { current = s || current; draw(); });
  draw();
}

/**
 * The Usage tab in Settings: show or hide the meter, the Gemini daily budget,
 * and what is known right now.
 * @param {HTMLElement} container
 * @param {{ proxy: any, settings: object, onSettings: Function, save: (patch: object) => Promise<object> }} ctx
 */
export function mountUsageSettings(container, { proxy, settings, onSettings, save }) {
  if (!container || !proxy || !proxy.usage) return;
  const range = proxy.constants.SETTINGS_LIMITS.geminiDailyRequests;
  let current = settings || {};

  const show = el('input', { type: 'checkbox', id: 'usage-show' });
  const budget = el('input', {
    type: 'number',
    id: 'usage-gemini-budget',
    min: String(range.min),
    max: String(range.max),
    step: '1',
    inputmode: 'numeric',
    placeholder: 'none',
  });
  const budgetError = el('p', { className: 'field-error', role: 'alert', hidden: true });
  const now = el('div', { className: 'usage-now' });

  container.replaceChildren(el('fieldset', { className: 'usage-settings' }, [
    el('legend', { text: 'Usage meter' }),
    el('label', { className: 'option' }, [show, ' Show the usage meter in the title bar']),
    el('label', { className: 'field-label', for: 'usage-gemini-budget', text: 'Gemini daily request budget' }),
    budget,
    budgetError,
    el('p', { className: 'muted hint', text: 'Gemini has no way to ask how much quota is left, so Proxy counts the requests it sends each day. Type the daily limit of your key (or any number you want to stay under) to see it as a bar. Leave it empty to show just the count.' }),
    el('p', { className: 'muted hint', text: 'Claude (Pro) shows the 5-hour and weekly limits that the Claude Code CLI reports with each reply. Nothing is known until the first reply. Proxy never contacts Anthropic just to check.' }),
    el('div', { className: 'field-label', text: 'Right now' }),
    now,
  ]));

  function fill() {
    show.checked = !(current.usage && current.usage.show === false);
    const b = current.usage && current.usage.geminiDailyRequests;
    if (document.activeElement !== budget) budget.value = Number.isFinite(b) ? String(b) : '';
  }

  function drawNow(snap) {
    if (!snap) { now.replaceChildren(el('p', { className: 'muted', text: 'Loading…' })); return; }
    const rows = [];
    const t = Date.now();
    for (const w of snap.windows) {
      let value;
      if (w.status === 'unknown') value = 'not reported yet';
      else if (w.used !== null) value = `${Math.round(w.used * 100)}% used`;
      else value = { ok: 'fine', warning: 'close to the limit', limited: 'limit reached' }[w.status] || w.status;
      const reset = formatReset(w.resetsAt, t);
      rows.push([w.label, `${value}${reset && w.status !== 'unknown' ? `, resets ${reset}` : ''}`]);
    }
    rows.push(['Requests today', String(snap.today.requests)]);
    rows.push(['Tokens today', `${snap.today.inputTokens} in, ${snap.today.outputTokens} out`]);
    now.replaceChildren(el('table', { className: 'usage-table' }, [
      el('tbody', {}, rows.map(([k, v]) => el('tr', {}, [el('th', { text: k, scope: 'row' }), el('td', { text: v })]))),
    ]));
  }

  show.addEventListener('change', () => { save({ usage: { show: show.checked } }); });
  budget.addEventListener('change', () => {
    const v = parseBudget(budget.value, range);
    budgetError.hidden = v !== undefined;
    if (v === undefined) {
      budgetError.textContent = `Use a whole number from ${range.min} to ${range.max}, or leave it empty.`;
      return;
    }
    save({ usage: { geminiDailyRequests: v } });
  });

  getFeed(proxy).subscribe(drawNow);
  if (onSettings) onSettings((s) => { current = s || current; fill(); });
  fill();
  drawNow(getFeed(proxy).get());
}
