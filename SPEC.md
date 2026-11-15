# Proxy v0 spec

Proxy is a desktop assistant for Linux Mint Cinnamon (X11). You press a hotkey, drag a box around something on screen (or grab the whole screen), and the image lands in a floating chat panel where Gemini (or Claude, through your own Claude Pro login) answers. There is no server: everything runs on your machine, and the only network calls are to the model you picked.

**Priority for v0: it works.** Plain, functional UI. Styling stays separable so it can be redesigned later. The v1 UI phase (retro look, themes, keyboard-first controls, rich replies) is planned in section 9.

---

## 1. Features (v0)

### Capture
- **Region snip**, default `Ctrl+Alt+S`. The screen dims, you drag a box, the cropped image goes into the chat. `Esc` cancels.
- **Full screenshot**, default `Ctrl+Alt+A`. Captures the display the mouse is on.
- Both can also be triggered from buttons in the panel.
- All hotkeys are configurable in settings and re-register live when changed. Defaults avoid Super: on Cinnamon the menu grabs the Super key on press, so Super combos fire only sometimes, and `Super+S` opens the sound applet. Settings v1 files still on the old `Super+Shift+S/A/P` defaults are moved to the new defaults on load (settings v2); hotkeys the user changed are kept. The settings screen warns (without blocking) about Super combos and known Cinnamon shortcuts.

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
  - `toggle`: the `togglePanel` hotkey (default `Ctrl+Alt+P`) shows and hides it.

### Chat
- Normal chat with follow-ups. Each request sends the whole session's history (text and images) to the model.
- **Answer style** (setting): `answer` only, `explanation` only, or `both` (default).
- The model's reply is split into an **answer** section and an **explanation** section. Each has its own **Copy** button.
- Model failures (no key, network, quota) show as an error bubble in the chat; they do not crash the app. Temporary Gemini failures (5xx, timeouts) are retried with backoff, then the lite model is used for 10 minutes. The last error bubble has a **Retry** button (`chat:send` with `retry: true`).
- **Stop:** while a reply is on its way, the Send button becomes **Stop** (Esc does the same). It cancels the Gemini request and any automatic retry or fallback (`chat:cancel`), drops sends queued behind it, and leaves a small **Stopped** marker with a Retry button. The user can send again right away. Enter does not send while a reply is on its way, so the draft stays in the box.
- **Timeout:** each Gemini attempt gives up after 60 s, and a whole request (retries and fallbacks included) is cut off after 2.5 minutes with an error bubble that has Retry, so a hung call never spins forever.
- Screenshots larger than 2048 px on a side are scaled down for the copy sent to the model; history keeps the original.

### History
- Persistent sessions, like ChatGPT/Claude: a session list (newest first), **New chat**, open an old session and continue it, rename, delete.
- Session titles are set automatically from the first user message (first ~40 chars, or "Screenshot" if there's no text). Rename overrides it. Rename by double-clicking a chat, pressing F2 on it, or its pencil button.
- **Folders:** create (**+ Folder**), rename, collapse/expand and delete folders in the sidebar. Drag a chat onto a folder to file it, between folders to move it, or onto empty list space to take it out. Folders, membership and collapsed state persist across restarts. Deleting a folder never deletes chats: they move back to the top level. Folders are listed in creation order, above the unfiled chats; chats stay newest first inside each.

### LLM
- Gemini via the free API key in a local `.env` (`GEMINI_API_KEY`, gitignored; see `.env.example`). Model is `GEMINI_MODEL`, default `gemini-3.8-flash`; if the key can't use the configured model (404, or a zero free-tier quota), the adapter falls back to `gemini-3.5-flash-lite`, then `gemini-flash-latest`.
- Behind a provider adapter so another model can be swapped in later.
- **Claude (Pro)** (`provider: 'claude-pro'`): instead of an API key, Proxy runs the official Claude Code CLI on the user's machine (`claude -p`), logged in with their own Claude Pro/Max account (`claude auth login`). Replies count toward their normal Claude usage. Personal use only: Proxy only starts the `claude` command and never reads its login token or calls the API itself.
  - One short-lived `claude` process per request, in a new empty temp folder, with every tool off (`--tools ""`), `--safe-mode` (no user CLAUDE.md, hooks, plugins or MCP servers), `--no-session-persistence`. It can only answer; it can't read or change files or run commands.
  - Screenshots and the conversation go in on stdin as one stream-json user message (images as base64 blocks). Follow-ups resend the earlier turns, like Gemini. Only the newest 8 screenshots are attached.
  - `--json-schema` returns `{ answer, explanation }`. The label is `Claude (Pro) · <model>`, e.g. `Claude (Pro) · claude-haiku-5-5`.
  - Model: setting `claudeModel` (`haiku` default, fastest; `sonnet`; `opus`). A typical reply takes about 3 s with Haiku.
  - Stop kills the process (SIGTERM, then SIGKILL after 2 s). A request is cut off after 2 minutes with an error that has Retry.
  - The `claude` command is looked up in `CLAUDE_PATH` (from `.env`), then PATH, `~/.local/bin`, `~/.claude/local`, nvm and npm-global folders. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `GEMINI_API_KEY` are removed from its environment so it always uses the Pro login.
  - Clear errors with setup steps when the CLI isn't installed, isn't logged in, is too old, or the usage limit is reached.

### Out of scope for v0
Tray features beyond Show panel / Quit, auto-start, packaging/installers, Wayland, streaming replies, Markdown rendering beyond plain text with line breaks (optional for Worker 3 if cheap).

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
core.history.moveSession(id, folderId)      // -> SessionSummary  (folderId null = top level; keeps updatedAt)
core.history.listFolders()                  // -> Folder[] in display order
core.history.createFolder(name)             // -> Folder  (empty name = "New folder")
core.history.updateFolder(id, { name?, collapsed? })  // -> Folder
core.history.deleteFolder(id)               // -> void; its chats move to the top level

core.chat.send(ChatSendRequest)             // -> Promise<ChatSendResult>
core.chat.cancel({ requestId?, sessionId? }) // -> { ok: true, cancelled: number }; the stopped send resolves
                                            //    with an assistant Message that has `stopped: true` (saved in history)

core.registerIpc(ipcMain, { sendToPanel })  // registers every Worker 2 INVOKE channel;
                                            // emits SETTINGS_CHANGED and HISTORY_CHANGED via sendToPanel
```

Storage (Worker 2's choice, suggested): `dataDir/settings.json`, `dataDir/history/<sessionId>.json` (one file per session, images inline as base64), plus `dataDir/history/index.json` for summaries and `dataDir/history/folders.json` for folders (each session file also stores its `folderId`, so an index rebuild keeps folder membership). Write atomically (write temp file, then rename). Corrupt files must not crash startup: fall back to defaults/empty and log.

### 4.2 Provider adapter (Worker 2) — `src/main/core/llm/`

```js
const provider = createProvider('gemini', { env, settings });   // llm/index.js ('gemini' | 'claude-pro')
await provider.generate({
  messages,      // Message[]: the whole session so far, including the new user message
  answerStyle,   // ANSWER_STYLES value
  signal,        // optional AbortSignal: abort to stop the call and its retries;
                 // generate() then rejects with an error whose `stopped` is true
});              // -> Promise<ProviderReply>  { answer: string, explanation: string }
                 //    throws Error with a user-readable message on failure
```

- `gemini.js` uses `@google/genai`. Ask for JSON output with a response schema `{ answer: string, explanation: string }` so the split is reliable. If JSON parsing fails, put the whole text in `answer`.
- Enforce the style after parsing: for `answer` set `explanation = ''`; for `explanation` set `answer = ''`.
- Previous assistant turns are sent back to the model as text (answer + explanation).
- Missing `GEMINI_API_KEY` → throw `Error('Gemini API key missing. Add GEMINI_API_KEY to .env and restart.')`.
- `chat.send` catches provider errors and stores/returns an assistant `Message` with `error` set. It does not reject for model errors.
- When the request is cancelled, `chat.send` stores/returns an assistant `Message` with `stopped: true` (no answer or error). Retry replaces it like a failed reply. Stopped turns are not sent to the model.

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
| `proxy.chat.send({ sessionId, text, images, requestId? })` | `ChatSendResult` | W2 |
| `proxy.chat.cancel(requestId)` or `proxy.chat.cancel({ sessionId })` | `{ ok, cancelled }` | W2 |
| `proxy.history.list()` | `SessionSummary[]` | W2 |
| `proxy.history.get(id)` | `Session \| null` | W2 |
| `proxy.history.create()` | `Session` | W2 |
| `proxy.history.rename(id, title)` | `SessionSummary` | W2 |
| `proxy.history.delete(id)` | `{ ok }` | W2 |
| `proxy.history.move(id, folderId)` | `SessionSummary` (`folderId` null = top level) | W2 |
| `proxy.folders.list()` | `Folder[]` | W2 |
| `proxy.folders.create(name)` | `Folder` | W2 |
| `proxy.folders.update(id, { name?, collapsed? })` | `Folder` | W2 |
| `proxy.folders.delete(id)` | `{ ok }` (chats move to the top level) | W2 |
| `proxy.settings.get()` | `Settings` | W2 |
| `proxy.settings.update(patch)` | `Settings` | W2 |
| `proxy.capture.region()` | `{ ok }`, image arrives as `capture:ready` | W1 |
| `proxy.capture.fullscreen()` | `{ ok }`, image arrives as `capture:ready` | W1 |
| `proxy.window.toggleFullscreen()` | `WindowState` | W1 |
| `proxy.window.hide()` | `WindowState` | W1 |
| `proxy.window.getState()` | `WindowState` | W1 |
| `proxy.clipboard.writeText(text)` | `{ ok }` | W1 |
| `proxy.on(eventName, cb)` | unsubscribe fn | — |
| `proxy.constants` | `{ EVENTS, SEND_MODES, PANEL_VISIBILITY, ANSWER_STYLES, PROVIDERS, CLAUDE_MODELS, DEFAULT_SETTINGS }` | — |

### Events (main → renderer)

| Event | Payload | Sent by |
|---|---|---|
| `capture:ready` | `CaptureResult` | W1 |
| `capture:error` | `{ message }` | W1 |
| `capture:cancelled` | none | W1 |
| `window:state` | `WindowState` | W1 |
| `settings:changed` | `Settings` | W2 |
| `history:changed` | none (re-fetch the chat list and folders) | W2 |

### Flow: snip with `sendMode = instant`
1. User presses `Ctrl+Alt+S` → W1 overlay → crop → `capture:ready` to renderer.
2. Renderer (W3) sees `sendMode === 'instant'` → `proxy.chat.send({ sessionId: current, text: '', images: [image] })`, showing a pending bubble.
3. W2 appends the user message, calls Gemini, appends the assistant message, emits `history:changed`, returns `ChatSendResult`.
4. Renderer shows answer/explanation per `answerStyle` with copy buttons.

With `sendMode = wait`, step 2 instead adds the image as an attachment chip in the composer; Send includes it.

---

## 6. Renderer (Worker 3)

- Layout: session sidebar (collapsible, since the panel is narrow), message list, composer (textarea + attachments + Send), toolbar (Snip, Full screenshot, New chat, Full-screen toggle, Hide, Settings).
- Settings view: AI provider (Gemini or Claude (Pro)) and, for Claude (Pro), the Claude model; hotkeys (text inputs with accelerator strings; validate non-empty or empty-to-disable), send mode, panel visibility, answer style. Saves through `proxy.settings.update`.
- While the open chat is waiting on a reply, the Send button reads **Stop** and calls `conversation.stop()` (Esc too). A stopped reply renders as a small "Stopped" marker; the last one has Retry.
- Assistant bubble: an "Answer" block and an "Explanation" block (only those with content), each with a Copy button using `proxy.clipboard.writeText`, and a small label with the model that answered (`Message.model`). Error messages render as an error bubble; the last one has a Retry button when the failed message was saved.
- Enter sends, Shift+Enter is a newline. Paste of an image into the composer is a nice-to-have.
- **Styling is separable:** all colors, fonts, radii and spacing are CSS variables in `styles/theme.css`. Component CSS in `styles/app.css` uses only those variables. No inline styles in JS except for dynamic sizing.
- The CSP in `index.html` allows `data:` images only; don't load remote resources.
- Sidebar folders use HTML5 drag and drop inside the panel; the grouping logic lives in `lib/folders.js` so it is unit-tested.

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

---

## 9. UI phase (v1): the retro look

**Status: plan, waiting for Austin's approval.** Nothing in this section is built yet. When it is approved, the lead lands step 0 (section 9.8), then three workers build in parallel. Where this section and sections 1 to 8 disagree, this section wins for v1.

### 9.1 Goal

Proxy is a small study tutor that sits in a corner while the real work (an ungraded chemistry practice assignment) fills the screen. It should feel like an old-school Linux desktop: a retro anime gamer/coder terminal with monospace type, soft glow and scanlines, in the spirit of Austin's Type Dungeon page. It is fast, keyboard first, silent, and every part of the look is customizable.

**Demo moment:** snip a chemistry question, and within seconds a themed panel in the top right shows the answer big and first, with a rendered equation (`\ce{2H2 + O2 -> 2H2O}`) and the explanation under it. Then Ctrl+K, type "neon", Enter, and the whole panel switches theme.

### 9.2 Features (priority order)

**Must have**
1. **Themes.** Four built-in themes (9.4) plus user themes: duplicate a theme, edit its colors, rename, delete, import and export as JSON. The default is **Dungeon**.
2. **Retro look.** Monospace UI, soft text glow, optional scanlines and vignette, sharp small radii, a custom title bar. Each effect can be turned off, and its strength is part of the theme.
3. **Fonts per text level.** Six levels: `title`, `ui`, `answer`, `explanation`, `body`, `code`. Each has a family and a size (and a weight for `answer` and `title`). Users can pick a bundled font, type the name of any font installed on the computer, or import a `.ttf`, `.otf` or `.woff2` file.
4. **Backgrounds and images.** No images ship with Proxy. Users can set their own background image for the panel (fit, dim and blur controls). Images are copied into Proxy's data folder, so moving the original file later doesn't break the theme.
5. **Panel.** Always expanded as a small box (no collapse to a bar). Frameless with a custom title bar. Draggable anywhere by the title bar. Docks to any of the 4 corners; **top right by default**. Releasing a drag within 48 px of a corner snaps it there. The size is remembered.
6. **Keyboard first.** A command bar (Ctrl+K) that runs every action by name, plus direct shortcuts (9.6). Every shortcut can be changed in Settings. A global hotkey brings keyboard focus to the panel without the mouse.
7. **Answer first.** The answer is a large, highlighted block at the top of each reply; the explanation follows it, smaller, and can be collapsed (Ctrl+E). The model is told to keep the answer short.
8. **Rich replies.** Markdown (headings, lists, tables, bold), math rendered as real equations including chemistry (`\ce{...}`), highlighted code, and graphs that Claude or Gemini draws with a `plot` block (9.7).
9. **Storage-like history.** Pin folders and chats (pinned ones sit at the top), search across every chat's text and replies (Ctrl+F), and keep the existing folders and drag and drop.
10. **Usage meter.** A small meter in the title bar showing how much is left, honestly sourced (9.5.4).

**Nice to have (only after the must haves merge)**
- Reorder folders by dragging.
- Chemistry structure drawings from SMILES and Mermaid flowcharts. Both need a library and probably a CSP change, so each needs a lead decision first.

**Not in v1:** animations and transitions, sounds (Proxy stays silent), bundled anime art or mascots, a collapse-to-bar mode, theme sharing online.

### 9.3 Who owns what (UI phase)

Worker numbers keep their old main-process folders, so W1 still owns the shell and W2 still owns core. The renderer is split by subfolder so no two workers share a file.

| Worker | Area | Owns | Tests |
|---|---|---|---|
| **W1: Keys and panel** | Frameless panel, docking and snapping, global hotkeys, command bar, keymap, the Settings screen frame, asset files (images and fonts) | `src/main/shell/**`, `src/renderer/keys/**`, `src/renderer/views/settings.js`, `src/renderer/lib/settings-form.js`, `src/renderer/lib/accelerator.js` | `test/shell/**`, `test/renderer/keys/**`, `test/renderer/settings-form.test.js`, `test/renderer/accelerator.test.js` |
| **W2: Replies and storage** | Settings validation, history, pins, search, usage tracking, the prompt, rich reply rendering, chat list and sidebar, the usage meter | `src/main/core/**`, `src/renderer/render/**`, `src/renderer/usage/**`, `src/renderer/vendor/**`, `src/renderer/views/chat.js`, `src/renderer/views/sidebar.js`, `src/renderer/views/dom.js`, `src/renderer/lib/messages.js`, `src/renderer/lib/conversation.js`, `src/renderer/lib/folders.js` | `test/core/**`, `test/renderer/render/**`, `test/renderer/usage/**`, and the existing `messages`, `conversation`, `folders` tests |
| **W3: Look** | Theme engine, built-in themes, theme editor, fonts, backgrounds, effects, all visual styling | `src/renderer/theme/**`, `src/renderer/styles/**`, `src/renderer/assets/**` | `test/renderer/theme/**` |
| **Lead** | Contracts and wiring | everything in section 3, plus `src/renderer/index.html` and `src/renderer/app.js` (they become the renderer's composition root in step 0) | `test/shared/**` |

Rules that make the split work:
- **Styling:** W3 owns how everything looks. W1 and W2 may add their own structural CSS (`src/renderer/keys/keys.css`, `src/renderer/render/render.css`, `src/renderer/usage/usage.css`: layout, sizes, overflow), but every color, font, shadow and radius in them must be a `var(--…)` from 9.5.1. They use the class names in 9.5.6 so W3 can style them from `styles/app.css`.
- **Settings screen:** W1 owns the frame (tabs **General**, **Look**, **Keys**, **Usage**). The **Look** tab body is mounted by W3 (`mountLookSettings`), the **Usage** tab body by W2 (`mountUsageSettings`). W1 builds General (the existing fields) and Keys.
- **Vendored libraries** go in `src/renderer/vendor/` as plain ES module or browser builds, committed, each with a line in `src/renderer/vendor/VENDOR.md` (name, version, license, source URL). No bundler and no `package.json` change. The libraries approved for W2 are: `marked` (Markdown), `DOMPurify` (sanitizing), `temml` or KaTeX with `output: 'mathml'` plus mhchem (math and `\ce`), and `highlight.js` core with a few languages (python, javascript, c, cpp, java, sql, bash, json). Keep the vendor folder under 1.5 MB. Anything else is an interface change request.
- **Fonts** ship in `src/renderer/assets/fonts/` with their OFL license files (W3). No images ship anywhere.

### 9.4 Built-in themes

Colors are taken from Austin's reference screenshots. W3 may tune shades for contrast (body text at least 4.5:1 against its background), but keep each theme's character.

| id | Name | Character | bg | surface | text | muted | accent | accent 2 | Effects |
|---|---|---|---|---|---|---|---|---|---|
| `dungeon` | Dungeon (default) | Type Dungeon page: warm cream paper, sepia ink, crimson | `#e8dfd2` | `#f2ebe1` | `#3a2e28` | `#8a7a6d` | `#8e1b2a` | `#b08d57` | scanlines light, glow off |
| `neon-night` | Neon Night | headphones/night city: deep navy, cyan glow | `#070b1a` | `#0e1530` | `#d6e6ff` | `#7d8db5` | `#3ee6ff` | `#7a5cff` | scanlines medium, glow on |
| `fallen-angel` | Fallen Angel | black and silver, icy teal streaks, high contrast | `#050506` | `#121214` | `#ececf0` | `#8a8d96` | `#c9ced6` | `#4fb3c8` | scanlines off, glow soft white |
| `studio` | Studio | music studio console: dark teal with pink | `#0b1e24` | `#10303a` | `#cdf3f0` | `#6fa3a6` | `#ff5fa2` | `#39c5bb` | scanlines light, glow on |

### 9.5 Contracts

All of this goes into `src/shared/contracts.js` and `src/preload/preload.js` in step 0, before the workers start. Until a worker's side is merged, the others build against these shapes (with a small shim in their own folder if needed).

#### 9.5.1 Theme tokens (CSS variables), W3 defines, everyone uses

The theme engine sets these on `:root`. `styles/theme.css` holds the Dungeon values as the fallback. Existing names stay so current CSS keeps working.

```
Colors     --bg --surface --surface-2 --surface-hover --border --text --text-muted
           --accent --accent-2 --accent-text --danger --danger-bg --warning --success
           --focus-ring --selection-bg --overlay-shadow --drop-target-bg --drop-target-border
Answer     --answer-bg --answer-text --answer-border --answer-glow
Bubbles    --bubble-user-bg --bubble-user-text --bubble-assistant-bg --bubble-assistant-text
           --bubble-error-bg --bubble-error-text
Code/math  --code-bg --code-text --code-keyword --code-string --code-number --code-comment
           --code-function --math-text
Plots      --plot-axis --plot-grid --plot-1 --plot-2 --plot-3 --plot-4
Effects    --glow (a text-shadow value or none) --scanline-opacity (0 to 1) --vignette-opacity
           --bg-image (url(...) or none) --bg-dim (0 to 1) --bg-blur (px) --bg-fit (cover|contain|auto)
Fonts      --font-title --font-ui --font-answer --font-explanation --font-body --font-code
           --size-title --size-ui --size-answer --size-explanation --size-body --size-code
           --weight-title --weight-answer
Shape      --radius --radius-small --gap --titlebar-height --sidebar-width --folder-indent
           --thumb-height --chip-size --bubble-max-width
```
`--font` and `--font-mono` stay as aliases of `--font-ui` and `--font-code`.

#### 9.5.2 Theme and font shapes

```js
/** @typedef {{ family: string, size: number, weight?: number }} FontChoice   size in px (10 to 40) */

/**
 * @typedef {Object} ThemeDef
 * @property {string} id            'dungeon' etc. for built-ins; 'user-<random>' for user themes
 * @property {string} name
 * @property {'light'|'dark'} base  used for the scrollbars and the native title bar fallback
 * @property {Object<string,string>} colors   keys are the color, answer, bubble, code and plot token
 *                                  names without the leading '--' (e.g. { bg: '#070b1a', 'answer-glow': ... });
 *                                  missing keys fall back to the theme's base defaults
 * @property {{ scanlines: number, glow: number, vignette: number }} effects   each 0 to 1 (0 = off)
 * @property {number} radius        px, 0 to 12
 */
```
Built-in themes live in W3's code (`src/renderer/theme/themes.js`), not in settings.

Default fonts (W3 bundles them, all SIL OFL): `title` VT323 22px, `ui` JetBrains Mono 12px, `answer` JetBrains Mono 17px weight 700, `explanation` IBM Plex Sans 14px, `body` IBM Plex Sans 14px, `code` JetBrains Mono 13px. Imported font files are loaded with `new FontFace(family, arrayBuffer)` (no CSP change needed).

#### 9.5.3 New settings (settings version 3)

```js
appearance: {
  themeId: 'dungeon',          // a built-in id or a customThemes[].id; unknown ids fall back to 'dungeon'
  customThemes: [],            // ThemeDef[], max 50; replaced as a whole on update
  fonts: {                     // FontChoice per level; merged per level on update
    title: { family: 'VT323', size: 22, weight: 400 },
    ui: { family: 'JetBrains Mono', size: 12 },
    answer: { family: 'JetBrains Mono', size: 17, weight: 700 },
    explanation: { family: 'IBM Plex Sans', size: 14 },
    body: { family: 'IBM Plex Sans', size: 14 },
    code: { family: 'JetBrains Mono', size: 13 },
  },
  customFonts: [],             // [{ assetId, family }] imported font files
  effects: null,               // null = use the theme's; or { scanlines, glow, vignette } to override
  background: { assetId: null, fit: 'cover', dim: 0.6, blur: 0 },   // dim 0 to 1, blur 0 to 20 px
},
panel: {
  dock: 'top-right',           // PANEL_DOCKS value: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'free'
  snap: true,                  // snap to a corner when a drag ends within 48 px of it
  margin: 16,                  // px between a docked panel and the screen edge (0 to 64)
  explanationCollapsed: false,
},
keymap: {},                    // { [commandId]: accelerator }, overrides of the defaults in 9.6; '' disables
usage: { show: true, geminiDailyRequests: null },   // a daily request budget the user types in, or null
hotkeys: { ...existing, focusPanel: 'Ctrl+Alt+Space' },
```
- `settings.update` merges `appearance`, `panel` and `usage` one level deep, `appearance.fonts` per level, `keymap` per key, and replaces arrays. Invalid values are dropped as today.
- **W2's first PR** makes `core/settings.js` validate these keys (it drops unknown keys today, so nothing new persists until it lands). The lead adds a `SETTINGS_LIMITS` object in contracts (ranges, max lengths) so the validation and the UI agree.
- v2 files load with the new defaults filled in; nothing the user set changes.

#### 9.5.4 Usage meter: what we can honestly show

Neither backend gives a simple "percent left" for every case, so the meter shows what each one really reports and says where the number comes from.

- **Claude (Pro):** the Claude Code CLI already emits `rate_limit_event` lines in the `stream-json` output Proxy reads. Their `rate_limit_info` has `status` (`allowed`, `allowed_warning`, `rejected`), `resetsAt`, `rateLimitType` (`five_hour`, `seven_day`, …) and, when the CLI has it, `utilization` (0 to 1) per window. W2 keeps the latest one. The meter shows the 5-hour and weekly bars with their reset times when `utilization` is present, and just the status and reset time when it isn't. Nothing is known until the first reply of the session, and the meter says so ("Usage shows after your first reply"). Proxy never calls Anthropic itself to ask.
- **Gemini:** the API has no "quota left" call. W2 counts requests and tokens per local day (from `usageMetadata`), and after a 429 marks the meter as limited until the `retryDelay` it returned. If the user typed a daily budget in Settings > Usage, the meter shows used / budget; otherwise it shows the count only.

```js
/**
 * @typedef {Object} UsageWindow
 * @property {'five_hour'|'seven_day'|'day'} id
 * @property {string} label          'Next 5 h', 'This week', 'Today'
 * @property {number|null} used      0 to 1, or null when unknown
 * @property {number|null} resetsAt  epoch ms, or null
 * @property {'ok'|'warning'|'limited'|'unknown'} status
 *
 * @typedef {Object} UsageSnapshot
 * @property {string} provider       PROVIDERS value
 * @property {'claude-cli'|'local-count'} source
 * @property {UsageWindow[]} windows
 * @property {{ requests: number, inputTokens: number, outputTokens: number }} today
 * @property {number|null} updatedAt epoch ms of the last change
 */
```
Stored in `dataDir/usage.json` (W2), counts kept for 14 days.

#### 9.5.5 New IPC

| Call (`window.proxy`) | Channel | Returns | Owner |
|---|---|---|---|
| `history.setPinned(id, pinned)` | `history:set-pinned` | `SessionSummary` | W2 |
| `history.search(query, { limit? })` | `history:search` | `SearchHit[]` (newest first, limit default 50) | W2 |
| `folders.update(id, { name?, collapsed?, pinned? })` | `folder:update` (gains `pinned`) | `Folder` | W2 |
| `usage.get()` | `usage:get` | `UsageSnapshot` | W2 |
| `window.dock(corner)` | `window:dock` | `WindowState` | W1 |
| `assets.import(kind)` | `assets:import` | `AssetInfo \| null` (null = dialog cancelled) | W1 |
| `assets.get(id)` | `assets:get` | `{ id, mimeType, dataBase64 } \| null` | W1 |
| `assets.list(kind?)` | `assets:list` | `AssetInfo[]` | W1 |
| `assets.delete(id)` | `assets:delete` | `{ ok }` | W1 |

| Event | Payload | Sent by |
|---|---|---|
| `usage:changed` | `UsageSnapshot` | W2 |

Shape changes:
- `SessionSummary` and `Folder` gain `pinned: boolean` and `pinnedAt: number|null`. Sidebar order: pinned folders (most recently pinned first), other folders (creation order), pinned chats, other chats (newest first). Inside a folder, pinned chats come first.
- `SearchHit = { sessionId, title, folderId, messageId, snippet, matchStart, matchLength, updatedAt }`. Search is case-insensitive over titles, user text, answers and explanations, done in the main process.
- `WindowState` gains `dock` (a `PANEL_DOCKS` value) and `focused: boolean`.
- `AssetInfo = { id, kind: 'image'|'font', name, mimeType, bytes, createdAt }`. Images larger than 2560 px on a side are scaled down on import; files over 15 MB are refused with a readable error. Assets live in `dataDir/assets/`. `createShell` gains a `dataDir` option (lead wires it).
- New enum `PANEL_DOCKS`, and `proxy.constants` gains `PANEL_DOCKS` and `SETTINGS_LIMITS`.

#### 9.5.6 Renderer modules and class names (between workers)

```js
// src/renderer/keys/commands.js (W1)
registerCommand({ id, title, group, run, when? })   // -> unregister(); id like 'chat.new'
runCommand(id)                                      // -> Promise<void>
listCommands()                                      // -> [{ id, title, group, keys }]
mountKeys({ proxy, settings, onSettings })          // installs the keymap and the Ctrl+K bar

// src/renderer/theme/index.js (W3)
mountTheme({ proxy, settings, onSettings })         // applies appearance now and on every change
mountLookSettings(container, { proxy, settings, save })
listThemes(settings)                                // built-ins + customThemes, for the command bar

// src/renderer/render/index.js (W2)
renderRich(markdown, { kind: 'answer'|'explanation' })   // -> HTMLElement (sanitized)

// src/renderer/usage/index.js (W2)
mountUsageMeter(slot, { proxy, settings, onSettings })
mountUsageSettings(container, { proxy, settings, save })
```
Each worker registers its own commands from its mount function (W3: one `theme.<id>` command per theme; W2: pin, search, collapse explanation; W1: panel and window commands). `app.js` (lead) registers the chat commands by calling the existing chat and sidebar code.

Class names W2 and W1 emit and W3 styles: `.titlebar`, `.drag-region`, `.no-drag`, `.msg`, `.msg-user`, `.msg-assistant`, `.msg-error`, `.reply-answer`, `.reply-explanation`, `.reply-explanation.collapsed`, `.reply-model`, `.rich` (root of rendered Markdown), `.rich-math`, `.rich-code`, `.rich-table`, `.rich-plot`, `.pin`, `.is-pinned`, `.search-box`, `.search-hit`, `.search-mark`, `.usage-meter`, `.usage-bar`, `.usage-bar.warning`, `.usage-bar.limited`, `.cmdbar`, `.cmdbar-input`, `.cmdbar-item`, `.cmdbar-item.active`, `.kbd`. New ones go in this list through the lead.

### 9.6 Keyboard map (defaults, all rebindable)

| Keys | Command id | Action |
|---|---|---|
| `Ctrl+Alt+Space` (global) | `hotkeys.focusPanel` | Show the panel and put the cursor in the message box; press again to give focus back (best effort on X11) |
| `Ctrl+K` | `app.commandBar` | Open the command bar: type to filter, arrows to move, Enter to run, Esc to close |
| `Ctrl+N` | `chat.new` | New chat |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | `chat.next` / `chat.prev` | Next / previous chat in sidebar order |
| `Ctrl+P` | `chat.switch` | Command bar listing chats by name |
| `Ctrl+Shift+C` | `chat.copyAnswer` | Copy the latest answer |
| `Ctrl+E` | `reply.toggleExplanation` | Collapse / expand explanations |
| `Ctrl+F` | `history.search` | Search all chats |
| `Ctrl+Shift+P` | `history.pinCurrent` | Pin / unpin the open chat |
| `Ctrl+B` | `app.toggleSidebar` | Show / hide the chat list |
| `Alt+1` `Alt+2` `Alt+3` `Alt+4` | `panel.dock.*` | Dock top left, top right, bottom left, bottom right |
| `Ctrl+,` | `app.settings` | Open Settings |
| `Ctrl+T` | `theme.next` | Next theme |
| `Esc` | (fixed) | Stop a reply; otherwise close the command bar, search or settings |
| `Enter` / `Shift+Enter` | (fixed) | Send / new line |

The existing global capture hotkeys stay as they are (`Ctrl+Alt+S`, `Ctrl+Alt+A`, `Ctrl+Alt+P`). Shortcuts only work while the panel has focus, except the globals. The Keys tab shows every command with its keys, lets the user record new ones, and warns about duplicates.

### 9.7 Rich replies

- **Prompt (W2, both providers):** the answer is the shortest complete result (a number with units, a balanced equation, a choice letter), the explanation is the steps. Use Markdown, `$...$` and `$$...$$` for math, `\ce{...}` for chemistry, fenced code with a language, and a `plot` block when a graph helps.
- **Rendering:** Markdown is parsed with `marked`, sanitized with DOMPurify (allow list, no raw HTML from the model, no `style` attributes, links shown as text), then math becomes MathML (Chromium renders it natively, so no CSP change) and code is highlighted. Rendering errors fall back to plain text, never to a crash.
- **`plot` blocks:** fenced code with language `plot` holding JSON. W2 draws it as SVG with DOM calls (no `innerHTML`, no `eval`; expressions use a small parser that knows `+ - * / ^`, parentheses, `x`, `pi`, `e` and `sin cos tan asin acos atan sqrt abs ln log exp`).
  ```json
  { "title": "Titration curve", "x": { "label": "mL NaOH", "min": 0, "max": 50 },
    "y": { "label": "pH", "min": 0, "max": 14 },
    "series": [ { "label": "fit", "fn": "7 + 6*atan((x-25)/2)/pi" },
                { "label": "data", "points": [[0,1.2],[10,1.8],[25,7],[40,12.1]] } ] }
  ```
  Bad JSON shows the block as code with a small "couldn't draw this graph" note.
- **Answer block:** `.reply-answer` uses `--font-answer`, `--size-answer`, the answer colors and glow. The explanation under it uses the explanation font. Each keeps its Copy button.

### 9.8 Build order and "done"

**Step 0, lead (one small PR, right after approval):** contracts and preload for 9.5, `SETTINGS_VERSION = 3` with defaults, contract tests, `createShell` gets `dataDir`, and the renderer skeleton: `index.html` gets the title bar, the usage meter slot, the command bar root, the settings tabs and the new stylesheet links; `app.js` calls `mountTheme`, `mountKeys`, `mountUsageMeter` and registers the chat commands; empty stub modules for `keys/`, `theme/`, `render/`, `usage/` so `npm start` works. CLAUDE.md gets the 9.3 table.

Then each worker opens small PRs in this order. "Done" for every PR: `npm test` passes, `npm start` opens the panel and it still loads, only owned files changed, and the PR description lists the 9.x items it covers.

**W1: Keys and panel**
1. Assets: `assets:*` IPC, file dialogs, image downscale, size limit. Done: an imported image and font come back from `assets.get` after a restart; unit tests for the id, name and size rules.
2. Frameless panel: custom title bar drag region, top right by default, `window:dock`, snap on drag end, `Alt+1..4`, position and size remembered. Done: drag anywhere, release near a corner and it snaps; geometry tests for snapping and docking on each display.
3. Command bar and keymap: `registerCommand`, fuzzy filter, the default keys in 9.6, `focusPanel` global hotkey. Done: every 9.6 action runs from the keyboard alone; tests for matching and key resolution.
4. Settings frame and Keys tab: tabs, General (existing fields), Keys editor with record and duplicate warnings.

**W2: Replies and storage**
1. Settings v3 validation and merging (unblocks everyone). Done: tests for every new key, bad values dropped, v2 file upgrades.
2. Rich replies: vendored libraries, `renderRich`, Markdown, code, answer-first markup, explanation collapse. Done: tests for sanitizing (script, event handlers and style attributes stripped) and section splitting.
3. Math and chemistry plus the new prompt. Done: `$x^2$`, `$$\frac{a}{b}$$` and `\ce{H2O}` render as MathML; prompt tests.
4. Plots. Done: the example in 9.7 draws; expression parser tests, including rejecting anything that isn't math.
5. Pins and search: core and sidebar, Ctrl+F results that open the chat at the hit. Done: history tests for ordering and search.
6. Usage: CLI `rate_limit_event` parsing, Gemini counting, `usage:*`, meter and Usage tab. Done: parser tests with recorded CLI lines; meter shows "unknown" honestly before the first reply.

**W3: Look**
1. Token set and theme engine: 9.5.1 tokens, the 4 built-in themes, `mountTheme`, bundled fonts, retro base styles (scanlines, glow, title bar, mono UI). Done: switching `themeId` restyles everything with no reload; a test checks every built-in theme defines every color token and meets the contrast floor.
2. Look tab: theme picker, fonts per level (bundled, system name, imported), effects sliders.
3. Theme editor: duplicate, edit colors with live preview, rename, delete, import and export JSON. Done: a user theme survives restart; tests for theme validation.
4. Backgrounds: pick an image through assets, fit, dim and blur, cleared when the asset is deleted.

**Integration (lead):** after each merge, tell the other workers to pull `main`. The final check is the demo moment in 9.1 on Mint, plus a full keyboard-only pass of 9.6.
