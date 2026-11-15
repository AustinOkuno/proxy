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

/** Where the panel sits. A docked panel stays in its corner; 'free' keeps panelBounds. (UI phase, SPEC 9) */
const PANEL_DOCKS = Object.freeze({
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right', // default
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
  FREE: 'free',
});

/** The text levels that each get their own font (SPEC 9.5.2). */
const FONT_LEVELS = Object.freeze(['title', 'ui', 'answer', 'explanation', 'body', 'code']);

/** Asset kinds the user can import (SPEC 9.5.5). */
const ASSET_KINDS = Object.freeze({
  IMAGE: 'image',
  FONT: 'font',
});

/**
 * Ranges and limits shared by validation (W2), the shell (W1) and the settings
 * UI (W1, W3), so they always agree. (SPEC 9.5.3)
 */
const SETTINGS_LIMITS = Object.freeze({
  fontSize: Object.freeze({ min: 10, max: 40 }),
  fontWeight: Object.freeze({ min: 100, max: 900 }),
  fontFamilyMaxLength: 100,
  customThemesMax: 50,
  customFontsMax: 20,
  themeNameMaxLength: 40,
  themeRadius: Object.freeze({ min: 0, max: 12 }),
  effect: Object.freeze({ min: 0, max: 1 }), // scanlines, glow, vignette
  backgroundDim: Object.freeze({ min: 0, max: 1 }),
  backgroundBlur: Object.freeze({ min: 0, max: 20 }), // px
  backgroundFits: Object.freeze(['cover', 'contain', 'auto']),
  panelMargin: Object.freeze({ min: 0, max: 64 }), // px
  snapDistance: 48, // px: a drag that ends this close to a corner docks there
  acceleratorMaxLength: 100,
  geminiDailyRequests: Object.freeze({ min: 1, max: 100000 }),
  searchLimit: Object.freeze({ default: 50, max: 200 }),
  assetMaxBytes: 15 * 1024 * 1024,
  imageMaxSide: 2560, // px; larger imported images are scaled down
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
  // UI phase (SPEC 9.5.5)
  HISTORY_SET_PINNED: 'history:set-pinned', // ({ id, pinned }) -> SessionSummary
  HISTORY_SEARCH: 'history:search', // ({ query, limit? }) -> SearchHit[]  (newest first)
  USAGE_GET: 'usage:get', // () -> UsageSnapshot

  // Owner: Worker 1 (shell)
  CAPTURE_REGION: 'capture:region', // () -> { ok: true }   result arrives via EVENTS.CAPTURE_READY
  CAPTURE_FULLSCREEN: 'capture:fullscreen', // () -> { ok: true }   result arrives via EVENTS.CAPTURE_READY
  WINDOW_TOGGLE_FULLSCREEN: 'window:toggle-fullscreen', // () -> WindowState
  WINDOW_HIDE: 'window:hide', // () -> WindowState
  WINDOW_GET_STATE: 'window:get-state', // () -> WindowState
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text', // ({ text }) -> { ok: true }
  // UI phase (SPEC 9.5.5)
  WINDOW_DOCK: 'window:dock', // ({ dock }) -> WindowState   dock is a PANEL_DOCKS value
  ASSETS_IMPORT: 'assets:import', // ({ kind }) -> AssetInfo | null   opens a file dialog; null = cancelled
  ASSETS_GET: 'assets:get', // ({ id }) -> AssetData | null
  ASSETS_LIST: 'assets:list', // ({ kind? }) -> AssetInfo[]
  ASSETS_DELETE: 'assets:delete', // ({ id }) -> { ok: true }
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
  USAGE_CHANGED: 'usage:changed', // (UsageSnapshot)  UI phase (SPEC 9.5.4)
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
 * @property {boolean} [pinned]       UI phase: pinned chats sort first (SPEC 9.5.5).
 * @property {number|null} [pinnedAt] Epoch ms it was pinned, or null.
 */

/**
 * A sidebar folder for grouping chats. Deleting one never deletes its chats.
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 * @property {boolean} collapsed   Remembered across restarts.
 * @property {boolean} [pinned]       UI phase: pinned folders sort first (SPEC 9.5.5).
 * @property {number|null} [pinnedAt] Epoch ms it was pinned, or null.
 */

/**
 * One search result (SPEC 9.5.5).
 * @typedef {Object} SearchHit
 * @property {string} sessionId
 * @property {string} title
 * @property {string|null} folderId
 * @property {string|null} messageId   null when only the title matched
 * @property {string} snippet          a short piece of text around the match
 * @property {number} matchStart       index of the match inside snippet
 * @property {number} matchLength
 * @property {number} updatedAt
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
 * @property {string} [dock]       UI phase: PANEL_DOCKS value
 * @property {boolean} [focused]   UI phase: the panel has keyboard focus
 */

/**
 * An imported image or font file, stored in dataDir/assets (SPEC 9.5.5).
 * @typedef {Object} AssetInfo
 * @property {string} id
 * @property {'image'|'font'} kind
 * @property {string} name        original file name, for display
 * @property {string} mimeType
 * @property {number} bytes
 * @property {number} createdAt
 */

/** @typedef {{ id: string, mimeType: string, dataBase64: string }} AssetData */

/**
 * @typedef {Object} UsageWindow
 * @property {'five_hour'|'seven_day'|'day'} id
 * @property {string} label            'Next 5 h', 'This week', 'Today'
 * @property {number|null} used        0 to 1, or null when unknown
 * @property {number|null} resetsAt    epoch ms, or null
 * @property {'ok'|'warning'|'limited'|'unknown'} status
 */

/**
 * What the usage meter shows (SPEC 9.5.4).
 * @typedef {Object} UsageSnapshot
 * @property {string} provider         PROVIDERS value
 * @property {'claude-cli'|'local-count'} source
 * @property {UsageWindow[]} windows
 * @property {{ requests: number, inputTokens: number, outputTokens: number }} today
 * @property {number|null} updatedAt   epoch ms of the last change
 */

/** @typedef {{ family: string, size: number, weight?: number }} FontChoice  size in px */

/**
 * A color theme (SPEC 9.5.2). Built-in themes live in the renderer (W3); user
 * themes are stored in settings.appearance.customThemes.
 * @typedef {Object} ThemeDef
 * @property {string} id                     built-in id, or 'user-<random>'
 * @property {string} name
 * @property {'light'|'dark'} base
 * @property {Object<string,string>} colors  token names without '--' -> CSS color
 * @property {{ scanlines: number, glow: number, vignette: number }} effects   each 0 to 1
 * @property {number} radius                 px
 */

/**
 * @typedef {Object} Appearance
 * @property {string} themeId
 * @property {ThemeDef[]} customThemes
 * @property {Record<string, FontChoice>} fonts   one per FONT_LEVELS entry
 * @property {{ assetId: string, family: string }[]} customFonts
 * @property {{ scanlines: number, glow: number, vignette: number }|null} effects   null = the theme's
 * @property {{ assetId: string|null, fit: string, dim: number, blur: number }} background
 */

/**
 * @typedef {Object} PanelPrefs
 * @property {string} dock                  PANEL_DOCKS value
 * @property {boolean} snap
 * @property {number} margin                px
 * @property {boolean} explanationCollapsed
 */

/**
 * @typedef {Object} Hotkeys
 * Electron accelerator strings (https://www.electronjs.org/docs/latest/api/accelerator).
 * "Super" is the Windows/Meta key. Empty string disables the hotkey.
 * Defaults avoid Super, which Cinnamon's menu and applets grab.
 * @property {string} regionSnip
 * @property {string} fullScreenshot
 * @property {string} togglePanel
 * @property {string} [focusPanel] UI phase: bring keyboard focus to the panel (SPEC 9.6); default
 *                                 'Ctrl+Alt+Space', added to the defaults with W1's command bar PR
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
 * @property {Appearance} appearance            UI phase (SPEC 9.5.3)
 * @property {PanelPrefs} panel                 UI phase
 * @property {Record<string,string>} keymap     UI phase: commandId -> accelerator overrides ('' disables)
 * @property {{ show: boolean, geminiDailyRequests: number|null }} usage   UI phase
 */

/**
 * appearance, panel and usage merge one level deep; appearance.fonts per level;
 * keymap per key; arrays (customThemes, customFonts) are replaced whole.
 * @typedef {Partial<Omit<Settings,'hotkeys'>> & { hotkeys?: Partial<Hotkeys> }} SettingsPatch
 */

// ---------------------------------------------------------------------------
// Settings defaults
// ---------------------------------------------------------------------------

// v3: UI phase (appearance, panel, keymap, usage, hotkeys.focusPanel; SPEC 9.5.3).
// No data moves: a v2 file loads with the new keys filled from these defaults
// and is saved back as v3. Nothing the user set changes.
// v2: hotkey defaults moved off Super. On Cinnamon, pressing Super starts the
// menu's grab, so Super+Shift+<key> reaches Proxy only sometimes, and
// Super+Shift+S also opens the sound applet (its "show menu" key is Super+S).
const SETTINGS_VERSION = 3;

/**
 * Hotkey defaults of settings v1. A saved v1 hotkey still equal to one of
 * these is moved to the new default on load (Worker 2's settings store).
 */
const LEGACY_HOTKEY_DEFAULTS = Object.freeze({
  regionSnip: 'Super+Shift+S',
  fullScreenshot: 'Super+Shift+A',
  togglePanel: 'Super+Shift+P',
});

/** @type {Readonly<Settings>} */
const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  hotkeys: Object.freeze({
    regionSnip: 'Ctrl+Alt+S',
    fullScreenshot: 'Ctrl+Alt+A',
    togglePanel: 'Ctrl+Alt+P',
    // focusPanel is not in the defaults yet: Worker 2's v1-migration test lists the
    // exact hotkeys. The shell and settings form fall back to 'Ctrl+Alt+Space'.
  }),
  sendMode: SEND_MODES.INSTANT,
  panelVisibility: PANEL_VISIBILITY.ALWAYS,
  answerStyle: ANSWER_STYLES.BOTH,
  provider: PROVIDERS.GEMINI,
  claudeModel: CLAUDE_MODELS.HAIKU,
  panelBounds: null,
  appearance: Object.freeze({
    themeId: 'dungeon',
    customThemes: Object.freeze([]),
    fonts: Object.freeze({
      title: Object.freeze({ family: 'VT323', size: 22, weight: 400 }),
      ui: Object.freeze({ family: 'JetBrains Mono', size: 12 }),
      answer: Object.freeze({ family: 'JetBrains Mono', size: 17, weight: 700 }),
      explanation: Object.freeze({ family: 'IBM Plex Sans', size: 14 }),
      body: Object.freeze({ family: 'IBM Plex Sans', size: 14 }),
      code: Object.freeze({ family: 'JetBrains Mono', size: 13 }),
    }),
    customFonts: Object.freeze([]),
    effects: null,
    background: Object.freeze({ assetId: null, fit: 'cover', dim: 0.6, blur: 0 }),
  }),
  panel: Object.freeze({
    dock: PANEL_DOCKS.TOP_RIGHT,
    snap: true,
    margin: 16,
    explanationCollapsed: false,
  }),
  keymap: Object.freeze({}),
  usage: Object.freeze({ show: true, geminiDailyRequests: null }),
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
  PANEL_DOCKS,
  FONT_LEVELS,
  ASSET_KINDS,
  SETTINGS_LIMITS,
  INVOKE,
  EVENTS,
  SETTINGS_VERSION,
  LEGACY_HOTKEY_DEFAULTS,
  DEFAULT_SETTINGS,
  defaultSettings,
};
