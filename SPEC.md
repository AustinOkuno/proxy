# Proxy v0 spec

Proxy is a desktop assistant for Linux Mint Cinnamon (X11). You press a hotkey, drag a box around something on screen (or grab the whole screen), and the image lands in a floating chat panel where Gemini answers. There is no server: everything runs on your machine, and the only network call is to the Gemini API.

**Priority for v0: it works.** Plain, functional UI. Styling stays separable so it can be redesigned later.

---

## 1. Features (v0)

### Capture
- **Region snip**, default `Super+Shift+S` (Super is the Windows key). The screen dims, you drag a box, the cropped image goes into the chat. `Esc` cancels.
- **Full screenshot**, default `Super+Shift+A`. Captures the display the mouse is on.
- Both can also be triggered from buttons in the panel.
- All hotkeys are configurable in settings and re-register live when changed.

### Send mode (setting)
- `instant` (default): the capture is sent to the model right away with no text.
- `wait`: the capture is attached to the composer; the user types a question and presses Send.

### Panel
- Floating, movable, resizable, always on top. Remembers its position and size.
- The window's close button (X) hides the panel; the app keeps running for hotkeys. Quit from the tray icon menu (**Quit Proxy**) or with Ctrl+Q.
- A button toggles full-screen and back.
- **Visibility** (setting):
  - `always` (default): panel is always shown.
  - `hidden-until-capture`: hidden at start; shown when a capture hotkey fires. The panel's hide button hides it again.
  - `toggle`: the `togglePanel` hotkey (default `Super+Shift+P`) shows and hides it.

### Chat
- Normal chat with follow-ups. Each request sends the whole session's history (text and images) to the model.
- **Answer style** (setting): `answer` only, `explanation` only, or `both` (default).
- The model's reply is split into an **answer** section and an **explanation** section. Each has its own **Copy** button.
- Model failures (no key, network, quota) show as an error bubble in the chat; they do not crash the app. Temporary Gemini failures (5xx, timeouts) are retried with backoff, then the lite model is used for 10 minutes. The last error bubble has a **Retry** button (`chat:send` with `retry: true`).
- Screenshots larger than 2048 px on a side are scaled down for the copy sent to the model; history keeps the original.

### History
- Persistent sessions, like ChatGPT/Claude: a session list (newest first), **New chat**, open an old session and continue it, rename, delete.
- Session titles are set automatically from the first user message (first ~40 chars, or "Screenshot" if there's no text). Rename overrides it.

### LLM
- Gemini via the free API key in a local `.env` (`GEMINI_API_KEY`, gitignored; see `.env.example`). Model is `GEMINI_MODEL`, default `gemini-3.8-flash`; if the key can't use the configured model (404, or a zero free-tier quota), the adapter falls back to `gemini-3.5-flash-lite`, then `gemini-flash-latest`.
- Behind a provider adapter so another model can be swapped in later.

### Out of scope for v0
Tray features beyond Show panel / Quit, auto-start, packaging/installers, Wayland, multi-provider UI, streaming replies, Markdown rendering beyond plain text with line breaks (optional for Worker 3 if cheap).

---

## 2. Architecture

```
┌──────────────────────── Electron main process (local backend) ────────────────────────┐
│                                                                                        │
│  src/main/index.js  (lead: composition root, wires modules)                            │
│        │                                                                               │
│        ├── src/main/shell/   (Worker 1)  hotkeys · capture · snip overlay · panel window │
│        │        uses core.settings (get / update / onChange)                           │
│        │                                                                               │
│        └── src/main/core/    (Worker 2)  settings store · history store · LLM provider  │
│                                                                                        │
└───────────────▲───────────────────────────────────────────────────────────────────────┘
                │ IPC (channel names in src/shared/contracts.js)
┌───────────────┴──────────┐
│ src/preload/preload.js   │  (lead) contextBridge → window.proxy
└───────────────▲──────────┘
                │
┌───────────────┴──────────┐
│ src/renderer/  (Worker 3) │  chat panel UI (HTML/CSS/JS, no framework required)
└──────────────────────────┘
```

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`. It only sees `window.proxy`.
- The Gemini key is only ever read in the main process (Worker 2). It never reaches the renderer.
- Plain CommonJS JavaScript in main/preload. The renderer may use ES modules (`<script type="module">`). No bundler, no TypeScript in v0.

---

## 3. Folder ownership

| Path | Owner | What |
|---|---|---|
| `src/shared/contracts.js` | **Lead** | IPC channel names, data shapes, settings schema/defaults |
| `src/preload/preload.js` | **Lead** | `window.proxy` bridge |
| `src/main/index.js` | **Lead** | Composition root |
| `package.json`, `package-lock.json` | **Lead** | Scripts and dependencies (see CLAUDE.md for adding deps) |
| `SPEC.md`, `CLAUDE.md`, `README.md` | **Lead** | Docs (workers may append to their own section in README via the lead) |
| `test/shared/` | **Lead** | Contract tests |
| `src/main/shell/**` | **Worker 1** | Hotkeys, capture, snip overlay, panel window |
| `test/shell/**` | **Worker 1** | |
| `src/main/core/**` | **Worker 2** | Settings, history, LLM provider |
| `test/core/**` | **Worker 2** | |
| `src/renderer/**` | **Worker 3** | Chat panel UI |
| `test/renderer/**` | **Worker 3** | |

Each worker folder already contains a working **stub** from the scaffold so the app runs end to end today. Replace the stub's internals; keep its exported shape.

---

## 4. Main-process module interfaces

These are the function boundaries between Worker 1, Worker 2 and the lead's `src/main/index.js`. Data shapes (`Settings`, `Session`, `Message`, `ImageData`, …) are JSDoc typedefs in `src/shared/contracts.js`.

### 4.1 Core (Worker 2) — `src/main/core/index.js`

```js
const core = await createCore({ dataDir, env });
// dataDir: string   writable folder (Electron userData, or PROXY_DATA_DIR)
// env:     process.env (GEMINI_API_KEY, GEMINI_MODEL)

core.settings.get()            // -> Settings (a copy)
core.settings.update(patch)    // -> Settings. Validates (bad enum values / unknown keys are dropped),
                               //    deep-merges `hotkeys`, persists, then calls onChange listeners.
core.settings.onChange(cb)     // cb(Settings). Returns an unsubscribe function.

core.history.listSessions()                 // -> SessionSummary[] newest first
core.history.getSession(id)                 // -> Session | null
core.history.createSession()                // -> Session
core.history.renameSession(id, title)       // -> SessionSummary
core.history.deleteSession(id)              // -> void
core.history.appendMessage(id, message)     // -> Message

core.chat.send(ChatSendRequest)             // -> Promise<ChatSendResult>

core.registerIpc(ipcMain, { sendToPanel })  // registers every Worker 2 INVOKE channel;
                                            // emits SETTINGS_CHANGED and HISTORY_CHANGED via sendToPanel
```

Storage (Worker 2's choice, suggested): `dataDir/settings.json`, `dataDir/history/<sessionId>.json` (one file per session, images inline as base64), plus `dataDir/history/index.json` for summaries. Write atomically (write temp file, then rename). Corrupt files must not crash startup: fall back to defaults/empty and log.

### 4.2 Provider adapter (Worker 2) — `src/main/core/llm/`

```js
const provider = createProvider('gemini', { env });   // llm/index.js
await provider.generate({
  messages,      // Message[]: the whole session so far, including the new user message
  answerStyle,   // ANSWER_STYLES value
});              // -> Promise<ProviderReply>  { answer: string, explanation: string }
                 //    throws Error with a user-readable message on failure
```

- `gemini.js` uses `@google/genai`. Ask for JSON output with a response schema `{ answer: string, explanation: string }` so the split is reliable. If JSON parsing fails, put the whole text in `answer`.
- Enforce the style after parsing: for `answer` set `explanation = ''`; for `explanation` set `answer = ''`.
- Previous assistant turns are sent back to the model as text (answer + explanation).
- Missing `GEMINI_API_KEY` → throw `Error('Gemini API key missing. Add GEMINI_API_KEY to .env and restart.')`.
- `chat.send` catches provider errors and stores/returns an assistant `Message` with `error` set. It does not reject for model errors.

### 4.3 Shell (Worker 1) — `src/main/shell/index.js`

```js
const shell = await createShell({
  settings,          // core.settings (get / update / onChange)
  preloadPath,       // absolute path to src/preload/preload.js
  rendererHtmlPath,  // absolute path to src/renderer/index.html
});

await shell.start()                     // creates the panel, registers hotkeys, applies panelVisibility
shell.showPanel()                       // show + focus
shell.sendToPanel(channel, payload)     // webContents.send to the panel (no-op if not open)
shell.registerIpc(ipcMain)              // registers every Worker 1 INVOKE channel
shell.dispose()                         // unregister hotkeys, close overlay
```

Responsibilities and rules:
- **Hotkeys:** register `settings.hotkeys.*` with `globalShortcut`. Re-register on `settings.onChange`. If a hotkey fails to register (taken by Cinnamon or another app), log it and send `EVENTS.CAPTURE_ERROR` with a readable message naming the key; don't crash.
- **Panel window:** `alwaysOnTop: true`, resizable, movable. webPreferences must be exactly `{ preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false }`. Save bounds with `settings.update({ panelBounds })` on move/resize (debounced). Apply `panelVisibility` at start and when it changes. Send `EVENTS.WINDOW_STATE` whenever visible/fullscreen changes.
- **Capture → chat:** after a successful capture, show the panel if hidden, then `sendToPanel(EVENTS.CAPTURE_READY, CaptureResult)`. The **renderer** decides what to do with it based on `sendMode`. The shell never calls the model.
- **Clipboard:** handles `INVOKE.CLIPBOARD_WRITE_TEXT` (sandboxed renderers can't reliably write the clipboard themselves).

### 4.4 Region snip (Worker 1)

Suggested approach (Worker 1 may change internals):
1. On hotkey, grab the display under the cursor with `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: <display size × scaleFactor> })`.
2. Open a frameless, transparent, always-on-top, full-display overlay `BrowserWindow` (files in `src/main/shell/overlay/`, its own preload) showing that screenshot dimmed; the user drags a rectangle; `Esc` cancels.
3. Crop the original `nativeImage` in main (`image.crop(rect)`, scaled by `scaleFactor`), encode PNG → `ImageData`.
4. Hide the panel during capture so it isn't in the shot; restore after.

Overlay IPC channels are private to Worker 1 and must use the prefix `overlay:`. They don't go in `contracts.js`.

---

## 5. IPC contract (renderer ↔ main)

Channel names live in `src/shared/contracts.js` (`INVOKE`, `EVENTS`). The renderer reaches them only through `window.proxy`, defined in `src/preload/preload.js`.

### `window.proxy` API (what Worker 3 builds against)

| Call | Returns | Handled by |
|---|---|---|
| `proxy.chat.send({ sessionId, text, images })` | `ChatSendResult` | W2 |
| `proxy.history.list()` | `SessionSummary[]` | W2 |
| `proxy.history.get(id)` | `Session \| null` | W2 |
| `proxy.history.create()` | `Session` | W2 |
| `proxy.history.rename(id, title)` | `SessionSummary` | W2 |
| `proxy.history.delete(id)` | `{ ok }` | W2 |
| `proxy.settings.get()` | `Settings` | W2 |
| `proxy.settings.update(patch)` | `Settings` | W2 |
| `proxy.capture.region()` | `{ ok }`, image arrives as `capture:ready` | W1 |
| `proxy.capture.fullscreen()` | `{ ok }`, image arrives as `capture:ready` | W1 |
| `proxy.window.toggleFullscreen()` | `WindowState` | W1 |
| `proxy.window.hide()` | `WindowState` | W1 |
| `proxy.window.getState()` | `WindowState` | W1 |
| `proxy.clipboard.writeText(text)` | `{ ok }` | W1 |
| `proxy.on(eventName, cb)` | unsubscribe fn | — |
| `proxy.constants` | `{ EVENTS, SEND_MODES, PANEL_VISIBILITY, ANSWER_STYLES, PROVIDERS, DEFAULT_SETTINGS }` | — |

### Events (main → renderer)

| Event | Payload | Sent by |
|---|---|---|
| `capture:ready` | `CaptureResult` | W1 |
| `capture:error` | `{ message }` | W1 |
| `capture:cancelled` | none | W1 |
| `window:state` | `WindowState` | W1 |
| `settings:changed` | `Settings` | W2 |
| `history:changed` | none (re-fetch the list) | W2 |

### Flow: snip with `sendMode = instant`
1. User presses `Super+Shift+S` → W1 overlay → crop → `capture:ready` to renderer.
2. Renderer (W3) sees `sendMode === 'instant'` → `proxy.chat.send({ sessionId: current, text: '', images: [image] })`, showing a pending bubble.
3. W2 appends the user message, calls Gemini, appends the assistant message, emits `history:changed`, returns `ChatSendResult`.
4. Renderer shows answer/explanation per `answerStyle` with copy buttons.

With `sendMode = wait`, step 2 instead adds the image as an attachment chip in the composer; Send includes it.

---

## 6. Renderer (Worker 3)

- Layout: session sidebar (collapsible, since the panel is narrow), message list, composer (textarea + attachments + Send), toolbar (Snip, Full screenshot, New chat, Full-screen toggle, Hide, Settings).
- Settings view: hotkeys (text inputs with accelerator strings; validate non-empty or empty-to-disable), send mode, panel visibility, answer style. Saves through `proxy.settings.update`.
- Assistant bubble: an "Answer" block and an "Explanation" block (only those with content), each with a Copy button using `proxy.clipboard.writeText`. Error messages render as an error bubble; the last one has a Retry button when the failed message was saved.
- Enter sends, Shift+Enter is a newline. Paste of an image into the composer is a nice-to-have.
- **Styling is separable:** all colors, fonts, radii and spacing are CSS variables in `styles/theme.css`. Component CSS in `styles/app.css` uses only those variables. No inline styles in JS except for dynamic sizing.
- The CSP in `index.html` allows `data:` images only; don't load remote resources.

---

## 7. Testing

- `npm test` runs `node --test "test/**/*.test.js"` (Node's built-in runner, no extra deps).
- Each worker tests its own logic in its own `test/<area>/` folder. Keep Electron-free logic (settings validation, history store, prompt building, reply parsing, accelerator validation, crop-rect math, message rendering helpers) in plain modules so it's testable without launching Electron.
- `npm start` must still open the app after every PR.

---

## 8. Build order and integration

The three workers start in parallel against the stubs. Nothing blocks on anyone else because the stubs already satisfy every contract.

Suggested PR sequence per worker (small PRs into `main`):
- **W1:** panel window behaviour + bounds → hotkeys + full screenshot → region snip overlay → visibility modes.
- **W2:** settings store (persisted, validated) → history store (persisted) → Gemini adapter → chat.send with errors.
- **W3:** layout + message list against stubs → composer + send modes → history sidebar → settings view → copy buttons.

The lead reviews interface-change requests and does the final end-to-end check on Mint.
