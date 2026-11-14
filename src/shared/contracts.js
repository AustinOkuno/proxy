'use strict';

/**
 * Proxy shared contracts.
 *
 * OWNER: lead. Workers must NOT edit this file. To change it, follow
 * "Requesting an interface change" in CLAUDE.md.
 *
 * Everything that crosses a worker boundary is defined here:
 *   - IPC channel names (renderer <-> main)
 *   - Data shapes (JSDoc typedefs) passed over IPC and between main modules
 *   - Settings schema and defaults
 *   - Enum values for settings
 *
 * This file must stay dependency-free (no electron, no node built-ins) so it can
 * be required from main, preload and tests.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** What happens after a capture lands in the chat. */
const SEND_MODES = Object.freeze({
  INSTANT: 'instant', // send to the model immediately with no text
  WAIT: 'wait', // attach to the composer, wait for the user to type and press Send
});

/** Panel visibility behaviour. */
const PANEL_VISIBILITY = Object.freeze({
  ALWAYS: 'always', // panel is always shown
  HIDDEN_UNTIL_CAPTURE: 'hidden-until-capture', // hidden at start, shown when a capture hotkey fires
  TOGGLE: 'toggle', // hidden/shown with the togglePanel hotkey
});

/** Which parts of the model's reply to show. */
const ANSWER_STYLES = Object.freeze({
  ANSWER: 'answer', // answer only
  EXPLANATION: 'explanation', // explanation only
  BOTH: 'both', // answer and explanation
});

const PROVIDERS = Object.freeze({
  GEMINI: 'gemini', // Google Gemini API, free key in .env
  CLAUDE_PRO: 'claude-pro', // local Claude Code CLI (`claude -p`), logged in with a Claude Pro/Max account
});

/** Model used by the Claude (Pro) provider: a Claude Code CLI model alias. */
const CLAUDE_MODELS = Object.freeze({
  HAIKU: 'haiku', // fastest, default
  SONNET: 'sonnet',
  OPUS: 'opus', // smartest, slowest, uses Pro limits fastest
});

// ---------------------------------------------------------------------------
// IPC channels
// ---------------------------------------------------------------------------

/**
 * Renderer -> main request/response channels (ipcRenderer.invoke / ipcMain.handle).
 * The "owner" is the worker that registers the ipcMain.handle for it.
 */
const INVOKE = Object.freeze({
  // Owner: Worker 2 (core)
  CHAT_SEND: 'chat:send', // (ChatSendRequest) -> ChatSendResult
  CHAT_CANCEL: 'chat:cancel', // ({ requestId?, sessionId? }) -> { ok: true, cancelled: number }  stops a send still waiting on the model
  HISTORY_LIST: 'history:list', // () -> SessionSummary[]  (newest first)
  HISTORY_GET: 'history:get', // ({ id }) -> Session | null
  HISTORY_CREATE: 'history:create', // () -> Session  (empty session, the "New chat" button)
  HISTORY_RENAME: 'history:rename', // ({ id, title }) -> SessionSummary
  HISTORY_DELETE: 'history:delete', // ({ id }) -> { ok: true }
  HISTORY_MOVE: 'history:move', // ({ id, folderId }) -> SessionSummary  (folderId null = top level)
  FOLDER_LIST: 'folder:list', // () -> Folder[]  (display order)
  FOLDER_CREATE: 'folder:create', // ({ name }) -> Folder
  FOLDER_UPDATE: 'folder:update', // ({ id, name?, collapsed? }) -> Folder
  FOLDER_DELETE: 'folder:delete', // ({ id }) -> { ok: true }  (its chats move to the top level)
  SETTINGS_GET: 'settings:get', // () -> Settings
  SETTINGS_UPDATE: 'settings:update', // (SettingsPatch) -> Settings  (validated, merged, saved)

  // Owner: Worker 1 (shell)
  CAPTURE_REGION: 'capture:region', // () -> { ok: true }   result arrives via EVENTS.CAPTURE_READY
  CAPTURE_FULLSCREEN: 'capture:fullscreen', // () -> { ok: true }   result arrives via EVENTS.CAPTURE_READY
  WINDOW_TOGGLE_FULLSCREEN: 'window:toggle-fullscreen', // () -> WindowState
  WINDOW_HIDE: 'window:hide', // () -> WindowState
  WINDOW_GET_STATE: 'window:get-state', // () -> WindowState
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text', // ({ text }) -> { ok: true }
});

/**
 * Main -> renderer push events (webContents.send / ipcRenderer.on).
 * The "owner" is the worker that sends it.
 */
const EVENTS = Object.freeze({
  // Owner: Worker 1 (shell)
  CAPTURE_READY: 'capture:ready', // (CaptureResult)
  CAPTURE_ERROR: 'capture:error', // ({ message })
  CAPTURE_CANCELLED: 'capture:cancelled', // ()  user pressed Esc in the snip overlay
  WINDOW_STATE: 'window:state', // (WindowState)

  // Owner: Worker 2 (core)
  SETTINGS_CHANGED: 'settings:changed', // (Settings)
  HISTORY_CHANGED: 'history:changed', // ()  sessions or folders changed; re-fetch HISTORY_LIST and FOLDER_LIST
});

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ImageData
 * @property {'image/png'|'image/jpeg'} mimeType
 * @property {string} dataBase64   Raw base64, no "data:" prefix.
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} CaptureResult
 * @property {'region'|'fullscreen'} kind
 * @property {ImageData} image
 * @property {number} capturedAt   Epoch ms.
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {'user'|'assistant'} role
 * @property {number} createdAt                 Epoch ms.
 * @property {string} [text]                    user: what they typed (may be empty).
 * @property {ImageData[]} [images]             user: attached screenshots.
 * @property {string} [answer]                  assistant: the direct answer section.
 * @property {string} [explanation]             assistant: the explanation section.
 * @property {string} [error]                   assistant: set instead of answer/explanation when the call failed.
 * @property {boolean} [stopped]                assistant: true when the user pressed Stop before the model answered
 *                                              (no answer/explanation/error). Retry can replace it.
 * @property {string} [answerStyle]             assistant: the ANSWER_STYLES value used for this reply.
 * @property {string} [model]                   assistant: the model that actually answered (after any fallback),
 *                                              e.g. "gemini-3.8-flash" or "Claude (Pro) · claude-haiku-5-5".
 */

/**
 * @typedef {Object} SessionSummary
 * @property {string} id
 * @property {string} title
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} messageCount
 * @property {string|null} folderId   The Folder this chat is in; null = top level.
 */

/**
 * A sidebar folder for grouping chats. Deleting one never deletes its chats.
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 * @property {boolean} collapsed   Remembered across restarts.
 */

/**
 * @typedef {SessionSummary & { messages: Message[] }} Session
 */

/**
 * @typedef {Object} ChatSendRequest
 * @property {string|null} sessionId   null = start a new session with this message.
 * @property {string} text             May be empty when images are present.
 * @property {ImageData[]} images      May be empty when text is present.
 * @property {boolean} [retry]         true = ask the model again for this session's last user
 *                                     message (dropping a failed or stopped reply after it); text and
 *                                     images are ignored. The result's userMessage is that existing message.
 * @property {string} [requestId]      Caller-chosen id so chat:cancel can stop this request.
 */

/**
 * @typedef {Object} ChatSendResult
 * @property {string} sessionId
 * @property {Message} userMessage
 * @property {Message} assistantMessage   On model failure this has `error` set; when stopped, `stopped: true`.
 *                                        chat:send does not reject for model errors or stops.
 */

/**
 * @typedef {Object} WindowState
 * @property {boolean} visible
 * @property {boolean} fullscreen
 * @property {boolean} alwaysOnTop
 */

/**
 * @typedef {Object} Hotkeys
 * Electron accelerator strings (https://www.electronjs.org/docs/latest/api/accelerator).
 * "Super" is the Windows/Meta key. Empty string disables the hotkey.
 * @property {string} regionSnip
 * @property {string} fullScreenshot
 * @property {string} togglePanel
 */

/**
 * @typedef {Object} PanelBounds
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Settings
 * @property {number} version
 * @property {Hotkeys} hotkeys
 * @property {string} sendMode          SEND_MODES value
 * @property {string} panelVisibility   PANEL_VISIBILITY value
 * @property {string} answerStyle       ANSWER_STYLES value
 * @property {string} provider          PROVIDERS value
 * @property {string} claudeModel       CLAUDE_MODELS value (used when provider is claude-pro)
 * @property {PanelBounds|null} panelBounds   Last panel position/size; null = default placement.
 */

/** @typedef {Partial<Omit<Settings,'hotkeys'>> & { hotkeys?: Partial<Hotkeys> }} SettingsPatch */

// ---------------------------------------------------------------------------
// Settings defaults
// ---------------------------------------------------------------------------

const SETTINGS_VERSION = 1;

/** @type {Readonly<Settings>} */
const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  hotkeys: Object.freeze({
    regionSnip: 'Super+Shift+S',
    fullScreenshot: 'Super+Shift+A',
    togglePanel: 'Super+Shift+P',
  }),
  sendMode: SEND_MODES.INSTANT,
  panelVisibility: PANEL_VISIBILITY.ALWAYS,
  answerStyle: ANSWER_STYLES.BOTH,
  provider: PROVIDERS.GEMINI,
  claudeModel: CLAUDE_MODELS.HAIKU,
  panelBounds: null,
});

/** Deep-ish copy of the defaults, safe to mutate. */
function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

// ---------------------------------------------------------------------------
// Model output contract (Worker 2 produces, Worker 3 renders)
// ---------------------------------------------------------------------------

/**
 * Providers must return replies already split into these two fields so the UI
 * can show and copy them separately. For ANSWER_STYLES.ANSWER, explanation is
 * ''. For ANSWER_STYLES.EXPLANATION, answer is ''. Both are Markdown text.
 *
 * @typedef {Object} ProviderReply
 * @property {string} answer
 * @property {string} explanation
 * @property {string} [model]   The model that actually answered.
 */

module.exports = {
  SEND_MODES,
  PANEL_VISIBILITY,
  ANSWER_STYLES,
  PROVIDERS,
  CLAUDE_MODELS,
  INVOKE,
  EVENTS,
  SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  defaultSettings,
};
