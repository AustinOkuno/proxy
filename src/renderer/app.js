// OWNER: Worker 3. Chat panel controller: wires window.proxy to the views.

import { canSend, createConversation } from './lib/conversation.js';
import { dataUrlToImage, imageToDataUrl } from './lib/messages.js';
import { el } from './views/dom.js';
import { createMessageList } from './views/chat.js';
import { createSidebar } from './views/sidebar.js';
import { createSettingsView } from './views/settings.js';

const proxy = window.proxy;
const { EVENTS, SEND_MODES, DEFAULT_SETTINGS } = proxy.constants;
const $ = (id) => document.getElementById(id);

const ui = {
  app: $('app'),
  banner: $('banner'),
  bannerText: $('banner-text'),
  chatView: $('chat-view'),
  settingsView: $('settings-view'),
  input: $('input'),
  send: $('btn-send'),
  attachments: $('attachments'),
  sidebarBtn: $('btn-sidebar'),
  fullscreenBtn: $('btn-fullscreen'),
};

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
/** Images attached in the composer, not yet sent. */
let attachments = [];

// ---------------------------------------------------------------------------
// Banner (capture errors, failures outside a chat)
// ---------------------------------------------------------------------------

let bannerTimer = null;
function showBanner(text, ms = 6000) {
  ui.bannerText.textContent = text;
  ui.banner.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => { ui.banner.hidden = true; }, ms);
}
$('banner-close').addEventListener('click', () => { ui.banner.hidden = true; });

/** Run a proxy call from a button, showing failures in the banner. */
async function attempt(what, fn) {
  try {
    return await fn();
  } catch (err) {
    showBanner(`${what} failed: ${(err && err.message) || err}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

const messageList = createMessageList($('messages'), {
  copy: (text) => proxy.clipboard.writeText(text),
  retry: () => conversation.retry(),
});

const conversation = createConversation({
  api: proxy,
  onChange: renderChat,
});

function renderChat() {
  messageList.render(conversation.visibleMessages(), { loading: conversation.loading, canRetry: conversation.canRetry() });
  sidebar.setCurrent(conversation.sessionId);
}

const sidebar = createSidebar($('session-list'), $('session-empty'), {
  onOpen: (id) => {
    showView('chat');
    conversation.open(id);
    if (isNarrow()) setSidebar(false);
  },
  onRename: (id, title) => attempt('Rename', () => proxy.history.rename(id, title)),
  onDelete: async (id) => {
    await attempt('Delete', () => proxy.history.delete(id));
    conversation.forget(id);
    refreshSessions();
  },
  onMove: async (id, folderId) => {
    await attempt('Moving the chat', () => proxy.history.move(id, folderId));
    refreshSessions();
  },
  onCreateFolder: () => attempt('New folder', () => proxy.folders.create('New folder')),
  onUpdateFolder: (id, patch) => attempt('Updating the folder', () => proxy.folders.update(id, patch)),
  onDeleteFolder: async (id) => {
    await attempt('Deleting the folder', () => proxy.folders.delete(id));
    refreshSessions();
  },
});

async function refreshSessions() {
  const [list, folders] = await Promise.all([
    attempt('Loading chats', () => proxy.history.list()),
    attempt('Loading folders', () => proxy.folders.list()),
  ]);
  if (list) sidebar.setData(list, folders || []);
}

function newChat() {
  showView('chat');
  conversation.newChat();
  ui.input.focus();
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function renderAttachments() {
  ui.attachments.replaceChildren(
    ...attachments.map((image, i) => {
      const remove = el('button', { type: 'button', className: 'chip-remove', 'aria-label': 'Remove image', text: '×' });
      remove.addEventListener('click', () => {
        attachments.splice(i, 1);
        renderAttachments();
      });
      return el('div', { className: 'chip' }, [
        el('img', { src: imageToDataUrl(image), alt: 'Attached screenshot' }),
        remove,
      ]);
    }),
  );
  ui.attachments.hidden = attachments.length === 0;
  updateSendButton();
}

function updateSendButton() {
  ui.send.disabled = !canSend({ text: ui.input.value, images: attachments });
}

function autosize() {
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, 160)}px`;
}

function submitComposer() {
  const draft = { text: ui.input.value, images: attachments };
  if (!canSend(draft)) return;
  conversation.send(draft);
  ui.input.value = '';
  attachments = [];
  renderAttachments();
  autosize();
  messageList.scrollToBottom();
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  submitComposer();
});

ui.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submitComposer();
  }
});

ui.input.addEventListener('input', () => {
  autosize();
  updateSendButton();
});

// Paste an image into the composer to attach it.
ui.input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => /^image\/(png|jpeg)$/.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = () => {
      const image = dataUrlToImage(String(reader.result));
      if (image) {
        attachments.push(image);
        renderAttachments();
      }
    };
    reader.readAsDataURL(file);
  }
});

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

function onCapture(result) {
  if (!result || !result.image) return;
  showView('chat');
  if (settings.sendMode === SEND_MODES.WAIT) {
    attachments.push(result.image);
    renderAttachments();
    ui.input.focus();
  } else {
    // Instant: send the capture on its own (SPEC 1, "Send mode"). Whatever is
    // in the composer stays there for the next message.
    conversation.send({ text: '', images: [result.image] });
  }
}

proxy.on(EVENTS.CAPTURE_READY, onCapture);
proxy.on(EVENTS.CAPTURE_ERROR, (p) => showBanner((p && p.message) || 'Capture failed.'));
proxy.on(EVENTS.CAPTURE_CANCELLED, () => {});

// ---------------------------------------------------------------------------
// Views, sidebar, toolbar
// ---------------------------------------------------------------------------

const settingsView = createSettingsView({
  form: $('settings-form'),
  status: $('settings-status'),
  constants: proxy.constants,
  save: (patch) => proxy.settings.update(patch),
  close: () => showView('chat'),
});

function showView(name) {
  const settingsOpen = name === 'settings';
  if (settingsOpen && ui.settingsView.hidden) settingsView.open(settings);
  if (!settingsOpen) settingsView.cancelRecording();
  ui.settingsView.hidden = !settingsOpen;
  ui.chatView.hidden = settingsOpen;
  ui.app.classList.toggle('settings-open', settingsOpen);
}

const isNarrow = () => window.matchMedia('(max-width: 560px)').matches;

function setSidebar(open) {
  ui.app.classList.toggle('sidebar-open', open);
  ui.sidebarBtn.setAttribute('aria-expanded', String(open));
}

function applyWindowState(state) {
  if (!state) return;
  ui.fullscreenBtn.title = state.fullscreen ? 'Exit full screen' : 'Full screen';
  ui.fullscreenBtn.classList.toggle('active', !!state.fullscreen);
}

ui.sidebarBtn.addEventListener('click', () => setSidebar(!ui.app.classList.contains('sidebar-open')));
$('btn-new').addEventListener('click', newChat);
$('btn-new-folder').addEventListener('click', () => sidebar.newFolder());
$('btn-new-side').addEventListener('click', () => {
  newChat();
  if (isNarrow()) setSidebar(false);
});
$('btn-snip').addEventListener('click', () => attempt('Snip', () => proxy.capture.region()));
$('btn-fullshot').addEventListener('click', () => attempt('Full screenshot', () => proxy.capture.fullscreen()));
$('btn-settings').addEventListener('click', () => showView(ui.settingsView.hidden ? 'settings' : 'chat'));
$('btn-fullscreen').addEventListener('click', async () => {
  applyWindowState(await attempt('Full screen', () => proxy.window.toggleFullscreen()));
});
$('btn-hide').addEventListener('click', () => attempt('Hide', () => proxy.window.hide()));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.settingsView.hidden) showView('chat');
});

proxy.on(EVENTS.WINDOW_STATE, applyWindowState);
proxy.on(EVENTS.HISTORY_CHANGED, refreshSessions);
proxy.on(EVENTS.SETTINGS_CHANGED, (next) => {
  if (!next) return;
  settings = next;
  settingsView.externalUpdate(next);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function init() {
  setSidebar(!isNarrow());
  renderChat();
  renderAttachments();
  const loaded = await attempt('Loading settings', () => proxy.settings.get());
  if (loaded) settings = loaded;
  applyWindowState(await attempt('Reading window state', () => proxy.window.getState()));
  await refreshSessions();
  ui.input.focus();
}

init();
