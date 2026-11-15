// OWNER: Worker 2 (UI phase). Message list rendering: answer first, explanation
// under it and collapsible (Ctrl+E), both rendered as rich Markdown (SPEC 9.2 #7, 9.7).

import { el, flashLabel } from './dom.js';
import { bubbleKind, imageToDataUrl, replySections, explanationCollapsed } from '../lib/messages.js';
import { renderRich } from '../render/index.js';
import { registerCommand } from '../keys/index.js';

/**
 * @param {HTMLElement} container
 * @param {{ copy: (text: string) => Promise<unknown>, retry?: () => unknown }} deps
 */
export function createMessageList(container, { copy, retry }) {
  const proxy = typeof window !== 'undefined' ? window.proxy : null;
  /** Ctrl+E state for every reply (settings.panel.explanationCollapsed). */
  let collapseAll = false;
  /** Replies the user opened or closed by hand since the last Ctrl+E: message id -> collapsed. */
  const overrides = new Map();
  let last = { messages: [], opts: {} };

  function applyCollapse(next, { save = false } = {}) {
    if (next === collapseAll && !overrides.size) return;
    collapseAll = next;
    overrides.clear();
    if (save && proxy) {
      proxy.settings.update({ panel: { explanationCollapsed: next } }).catch((err) => {
        console.warn('[chat] could not save explanationCollapsed:', err);
      });
    }
    api.render(last.messages, last.opts);
  }

  if (proxy) {
    const { EVENTS } = proxy.constants;
    const fromSettings = (s) => {
      const v = !!(s && s.panel && s.panel.explanationCollapsed);
      if (v !== collapseAll) applyCollapse(v);
    };
    proxy.settings.get().then(fromSettings, () => {});
    proxy.on(EVENTS.SETTINGS_CHANGED, fromSettings);
  }

  registerCommand({
    id: 'reply.toggleExplanation',
    title: 'Collapse or expand explanations',
    group: 'Chat',
    run: () => applyCollapse(!collapseAll, { save: true }),
  });
  function imageThumb(image) {
    const img = el('img', {
      className: 'thumb',
      src: imageToDataUrl(image),
      alt: 'Screenshot',
      title: 'Click to enlarge',
    });
    img.addEventListener('click', () => img.classList.toggle('expanded'));
    return img;
  }

  function copyButton(text, label) {
    const btn = el('button', { type: 'button', className: 'btn small copy', text: 'Copy', title: `Copy ${label.toLowerCase()}` });
    btn.addEventListener('click', async () => {
      try {
        await copy(text);
        flashLabel(btn, 'Copied');
      } catch {
        flashLabel(btn, 'Copy failed');
      }
    });
    return btn;
  }

  function retryButton() {
    const btn = el('button', { type: 'button', className: 'btn small retry', text: 'Retry', title: 'Ask again' });
    btn.addEventListener('click', () => {
      btn.disabled = true;
      retry();
    });
    return btn;
  }

  function answerSection(s) {
    return el('section', { className: 'reply-section reply-answer' }, [
      el('div', { className: 'reply-head' }, [
        el('span', { className: 'reply-label', text: s.label }),
        copyButton(s.text, s.label),
      ]),
      renderRich(s.text, { kind: 'answer' }),
    ]);
  }

  /** The explanation can only collapse when there is an answer above it to read. */
  function explanationSection(s, message, collapsible) {
    const collapsed = collapsible && explanationCollapsed(collapseAll, overrides, message.id);
    const section = el('section', { className: `reply-section reply-explanation${collapsed ? ' collapsed' : ''}` });
    const label = collapsible
      ? el('button', {
        type: 'button',
        className: 'reply-label reply-toggle',
        text: s.label,
        title: 'Show or hide the explanation (Ctrl+E for all)',
        'aria-expanded': String(!collapsed),
      })
      : el('span', { className: 'reply-label', text: s.label });
    if (collapsible) {
      label.addEventListener('click', () => {
        const next = !section.classList.contains('collapsed');
        section.classList.toggle('collapsed', next);
        label.setAttribute('aria-expanded', String(!next));
        if (message.id) overrides.set(message.id, next);
      });
    }
    section.append(
      el('div', { className: 'reply-head' }, [label, copyButton(s.text, s.label)]),
      renderRich(s.text, { kind: 'explanation' }),
    );
    return section;
  }

  function bubble(message, { canRetry = false } = {}) {
    switch (bubbleKind(message)) {
      case 'user':
        return el('div', { className: 'bubble user msg msg-user' }, [
          (message.images || []).length
            ? el('div', { className: 'bubble-images' }, message.images.map(imageThumb))
            : null,
          message.text ? el('div', { className: 'bubble-text', text: message.text }) : null,
        ]);
      case 'assistant': {
        const sections = replySections(message);
        const hasAnswer = sections.some((x) => x.key === 'answer');
        return el(
          'div',
          { className: 'bubble assistant msg msg-assistant' },
          [...sections.map((s) => (s.key === 'answer' ? answerSection(s) : explanationSection(s, message, hasAnswer))),
            message.model ? el('div', { className: 'reply-model', text: message.model, title: 'Model that answered' }) : null],
        );
      }
      case 'error':
        return el('div', { className: 'bubble error msg msg-error', role: 'alert' }, [
          el('div', { className: 'reply-head' }, [
            el('span', { className: 'reply-label', text: 'Error' }),
            canRetry && retry ? retryButton() : null,
          ]),
          el('div', { className: 'bubble-text', text: message.error }),
        ]);
      case 'stopped':
        return el('div', { className: 'bubble assistant stopped msg msg-assistant' }, [
          el('div', { className: 'reply-head' }, [
            el('span', { className: 'stopped-label', text: 'Stopped' }),
            canRetry && retry ? retryButton() : null,
          ]),
        ]);
      case 'pending':
        return el('div', { className: 'bubble assistant pending msg msg-assistant', text: message.stopping ? 'Stopping…' : 'Thinking…' });
      default:
        return el('div', { className: 'bubble assistant muted msg msg-assistant', text: '(empty reply)' });
    }
  }

  const api = {
    /**
     * @param {object[]} messages
     * @param {{ loading?: boolean, canRetry?: boolean }} [opts]  canRetry: show Retry on the last bubble if it failed
     */
    render(messages, opts = {}) {
      const { loading = false, canRetry = false } = opts;
      last = { messages: messages || [], opts };
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      container.replaceChildren();
      if (loading) {
        container.append(el('p', { className: 'muted empty-note', text: 'Loading…' }));
        return;
      }
      if (!messages.length) {
        container.append(
          el('div', { className: 'empty-chat' }, [
            el('p', { text: 'Snip part of the screen or type a question to start.' }),
            el('p', { className: 'muted', text: 'Paste an image into the box below to attach it.' }),
          ]),
        );
        return;
      }
      messages.forEach((m, i) => {
        const last = i === messages.length - 1;
        container.append(el('div', { className: `row ${m.role === 'user' ? 'from-user' : 'from-assistant'}` }, [
          bubble(m, { canRetry: canRetry && last }),
        ]));
      });
      if (nearBottom || messages[messages.length - 1].pending) {
        container.scrollTop = container.scrollHeight;
      }
    },
    scrollToBottom() {
      container.scrollTop = container.scrollHeight;
    },
  };
  return api;
}
