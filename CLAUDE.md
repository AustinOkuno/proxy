# Rules for anyone working on Proxy

Read `SPEC.md` first. It has the features, the folder ownership table, and the interfaces between workers. This file is the working rules.

## Who owns what

We are in the **UI phase** (SPEC.md section 9). This table is the current ownership; SPEC.md section 3 is the full list of paths and 9.3 has the details.

| You are | You may edit | Tests go in |
|---|---|---|
| **Worker 1** (keys and panel: frameless panel, docking, hotkeys, command bar, keymap, Settings frame, asset files) | `src/main/shell/**`, `src/renderer/keys/**`, `src/renderer/views/settings.js`, `src/renderer/lib/settings-form.js`, `src/renderer/lib/accelerator.js` | `test/shell/**`, `test/renderer/keys/**`, `test/renderer/settings-form.test.js`, `test/renderer/accelerator.test.js` |
| **Worker 2** (replies and storage: settings validation, history, pins, search, usage, prompt, rich replies, chat list, usage meter) | `src/main/core/**`, `src/renderer/render/**`, `src/renderer/usage/**`, `src/renderer/vendor/**`, `src/renderer/views/chat.js`, `src/renderer/views/sidebar.js`, `src/renderer/views/dom.js`, `src/renderer/lib/messages.js`, `src/renderer/lib/conversation.js`, `src/renderer/lib/folders.js` | `test/core/**`, `test/renderer/render/**`, `test/renderer/usage/**`, `test/renderer/messages.test.js`, `test/renderer/conversation.test.js`, `test/renderer/folders.test.js` |
| **Worker 3** (look: theme engine, built-in and user themes, fonts, backgrounds, effects, all visual styling) | `src/renderer/theme/**`, `src/renderer/styles/**`, `src/renderer/assets/**` | `test/renderer/theme/**` |
| **Lead** | `src/shared/**`, `src/preload/**`, `src/main/index.js`, `src/renderer/index.html`, `src/renderer/app.js`, `package.json`, `package-lock.json`, `src/renderer/package.json`, `test/renderer/package.json`, `SPEC.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.env.example`, `test/shared/**` | `test/shared/**` |

1. **Stay in your folder.** Do not edit, move, rename or reformat files outside the paths above, even to "fix" something small. If you need something outside your folder, request it (see below).
2. **Don't touch other workers' folders.** If you find a bug in someone else's area, describe it in your PR description or an issue; don't patch it.
3. **Keep the exported shape** of your folder's `index.js` exactly as SPEC.md section 4 describes. Internals are yours to change.
4. **Import shared things only from `src/shared/contracts.js`.** Never hard-code an IPC channel string; use `INVOKE.*` / `EVENTS.*`. (The renderer uses `window.proxy` and `window.proxy.constants`.)
5. Worker 1's overlay IPC is private to Worker 1 and uses the `overlay:` prefix.
6. **Styling belongs to Worker 3.** Workers 1 and 2 may add structural CSS in their own folder (`keys/keys.css`, `render/render.css`, `usage/usage.css`), but every color, font, shadow and radius must be a `var(--...)` token from SPEC.md 9.5.1, and they use the class names in SPEC.md 9.5.6.
7. **Renderer modules talk through the exports in SPEC.md 9.5.6** (`registerCommand`, `mountTheme`, `renderRich`, `mountUsageMeter`, ...). `app.js` mounts them; ask the lead for changes to `app.js` or `index.html`.

## Branches and PRs

- **One branch per worker per change.** Use the branch your session was assigned. If you choose the name, use `w1/<topic>`, `w2/<topic>`, `w3/<topic>` (e.g. `w2/settings-store`).
- Branch from the latest `main`. Before opening a PR, rebase on `main` again.
- **Small PRs into `main`**: one feature step each (see SPEC.md section 8 for a suggested order). Aim for something reviewable in a few minutes.
- A PR must:
  - only touch files you own (check `git diff --stat main`),
  - pass `npm test`,
  - keep `npm start` working (the app still opens and the panel still loads),
  - say in the description which SPEC.md items it covers and anything left for a later PR.
- Don't merge your own PR. Don't push to `main` or to another worker's branch. Never force-push a branch someone else is using.

## Requesting an interface change

Contracts (`src/shared/contracts.js`, `src/preload/preload.js`, SPEC.md sections 4 and 5, `src/main/index.js`) belong to the lead. When you need a new channel, a new field, a changed shape, or a new npm dependency:

1. **Don't edit the lead's files.** Open a GitHub issue titled `Interface change: <short summary>` (or, if you can't open issues, add an `## Interface change request` section to your PR description) with:
   - what you need and why,
   - the exact proposed change (code snippet or diff for `contracts.js` / `preload.js` / SPEC),
   - which other workers it affects.
2. Tell the person running the project in your thread that you've requested it, so the lead picks it up.
3. **Keep working.** Build against the current contract, or put a temporary shim inside your own folder, until the lead merges the change. Never block waiting.
4. The lead lands contract changes as their own small PR, updates SPEC.md, and notifies the affected workers. Then rebase and use it.

New dependencies follow the same process (the lead edits `package.json`). Prefer no new dependency when a few lines of code will do.

## Code style

- Plain JavaScript. CommonJS (`require`) in main and preload; ES modules allowed in the renderer. No TypeScript, no bundler in v0.
- `'use strict';` at the top of main-process files.
- Keep Electron-free logic in separate small modules so it can be unit-tested with `node --test` without launching Electron.
- Never log or send the Gemini API key anywhere. It stays in Worker 2's code in the main process.
- Renderer security stays as is: `contextIsolation: true`, `nodeIntegration: false`, no remote content, CSP unchanged unless the lead approves.
- UI styling: colors, fonts, spacing only via the CSS variables (tokens) in SPEC.md 9.5.1. The theme engine (Worker 3) sets them; `src/renderer/styles/theme.css` holds the fallback values.
- Vendored browser libraries go in `src/renderer/vendor/` with a line in `VENDOR.md`; only the ones SPEC.md 9.3 approves, others need an interface change request.

## Commands

```bash
npm install      # once
npm start        # run the app
npm test         # run all tests
```
