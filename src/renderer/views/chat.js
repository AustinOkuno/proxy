// OWNER: Worker 3. Message list rendering.

import { el, flashLabel } from './dom.js';
import { bubbleKind, imageToDataUrl, replySections } from '../lib/messages.js';

/**
 * @param {HTMLElement} container
 * @param {{ copy: (text: string) => Promise<unknown>, retry?: () => unknown }} deps
 */
export function createMessageList(container, { copy, retry }) {
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

  function bubble(message, { canRetry = false } = {}) {
    switch (bubbleKind(message)) {
      case 'user':
        return el('div', { className: 'bubble user' }, [
          (message.images || []).length
            ? el('div', { className: 'bubble-images' }, message.images.map(imageThumb))
            : null,
          message.text ? el('div', { className: 'bubble-text', text: message.text }) : null,
        ]);
      case 'assistant':
        return el(
          'div',
          { className: 'bubble assistant' },
          [...replySections(message).map((s) =>
            el('section', { className: `reply-section ${s.key}` }, [
              el('div', { className: 'reply-head' }, [
                el('span', { className: 'reply-label', text: s.label }),
                copyButton(s.text, s.label),
              ]),
              el('div', { className: 'bubble-text', text: s.text }),
            ]),
          ),
          message.model ? el('div', { className: 'reply-model', text: message.model, title: 'Model that answered' }) : null],
        );
      case 'error':
        return el('div', { className: 'bubble error', role: 'alert' }, [
          el('div', { className: 'reply-head' }, [
            el('span', { className: 'reply-label', text: 'Error' }),
            canRetry && retry ? retryButton() : null,
          ]),
          el('div', { className: 'bubble-text', text: message.error }),
        ]);
      case 'stopped':
        return el('div', { className: 'bubble assistant stopped' }, [
          el('div', { className: 'reply-head' }, [
            el('span', { className: 'stopped-label', text: 'Stopped' }),
            canRetry && retry ? retryButton() : null,
          ]),
        ]);
      case 'pending':
        return el('div', { className: 'bubble assistant pending', text: message.stopping ? 'Stopping…' : 'Thinking…' });
      default:
        return el('div', { className: 'bubble assistant muted', text: '(empty reply)' });
    }
  }

  return {
    /**
     * @param {object[]} messages
     * @param {{ loading?: boolean, canRetry?: boolean }} [opts]  canRetry: show Retry on the last bubble if it failed
     */
    render(messages, { loading = false, canRetry = false } = {}) {
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
}
