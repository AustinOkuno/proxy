# Proxy

A desktop assistant for Linux Mint Cinnamon. Press a hotkey, drag a box around anything on your screen, and ask Gemini or Claude about it in a floating chat panel. Runs entirely on your machine; the only network calls are to the model you pick.

> Status: **scaffold**. The window opens and the plumbing is wired, but capture, Gemini and the real chat UI are being built. See [SPEC.md](SPEC.md).

## Setup on Linux Mint

1. **Install Node.js 20 or newer.** Mint's apt version is usually too old, so use NodeSource:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs git
   node -v   # should print v22.x
   ```
2. **Get the code:**
   ```bash
   git clone https://github.com/austinokuno/proxy.git
   cd proxy
   npm install
   ```
3. **Pick your AI.** Proxy can use Gemini (free API key) or **Claude (Pro)** (your Claude subscription, no API key). You can switch any time in Settings. For Claude, see [Using Claude (Pro)](#using-claude-pro) below and you can skip the Gemini key.

   **Gemini:** get a free key at <https://aistudio.google.com/apikey>, then:
   ```bash
   cp .env.example .env
   nano .env        # paste your key after GEMINI_API_KEY=
   ```
   `.env` is gitignored, so your key never gets committed.
4. **Run it:**
   ```bash
   npm start
   ```

## Using Claude (Pro)

If you pay for Claude Pro (or Max), Proxy can answer with Claude instead of Gemini, without an API key. It runs the official **Claude Code** command on your computer, signed in with your Pro account, so replies count toward your normal Pro usage and cost nothing extra. This is meant for your own personal use.

1. **Install Claude Code** (one time). In a terminal:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```
   Close and reopen the terminal, then check it worked:
   ```bash
   claude --version
   ```
   (If you prefer npm: `npm install -g @anthropic-ai/claude-code`.)
2. **Sign in with your Pro account** (one time):
   ```bash
   claude auth login
   ```
   A browser window opens. Choose your **Claude subscription** (not the Console/API option) and sign in. `claude auth status` should then say `"loggedIn": true`.
3. **Switch Proxy to Claude:** open Proxy, click ⚙ Settings, under **AI** pick **Claude (Pro)**, pick a model, and press Save.
   - **Haiku** (default) is the fastest, about 3 seconds per answer.
   - **Sonnet** is smarter and a little slower.
   - **Opus** is the smartest and slowest, and uses up your Pro limit fastest.

Each answer is labelled `Claude (Pro) · <model>`. Stop (or Esc) cancels a reply; a reply that takes more than 2 minutes is cut off with a Retry button.

How it works: for each message Proxy runs `claude -p` in an empty temporary folder with all of Claude Code's tools turned off, so it can only answer. It can't read your files or run commands. Your own Claude Code settings, CLAUDE.md files, plugins and MCP servers are not loaded. If you have `ANTHROPIC_API_KEY` set, Proxy hides it from Claude Code so it always uses your Pro login instead of billing the API.

**If something goes wrong**, the chat shows what to do:
- *"Claude Code isn't installed"*: do step 1. If you installed it somewhere unusual, add `CLAUDE_PATH=/full/path/to/claude` to `.env` (find it with `which claude`) and restart Proxy.
- *"not logged in"*: run `claude auth login` again.
- *"too old"*: run `claude update`.
- *"usage limit"*: you've hit your Pro limit for now. Wait for it to reset, or switch to Gemini in Settings.

## Default hotkeys

| Action | Keys |
|---|---|
| Region snip | `Ctrl+Alt+S` |
| Full screenshot | `Ctrl+Alt+A` |
| Show/hide panel (when visibility is "toggle") | `Ctrl+Alt+P` |

All hotkeys can be changed in the app's settings (gear button). Avoid **Super** (the Windows key) on Cinnamon: pressing it starts the menu's key grab, so Super shortcuts reach Proxy only some of the time, and `Super+S` opens the sound applet. Older installs still on the old `Super+Shift+…` defaults are moved to the new ones automatically. If a hotkey doesn't work, Cinnamon may already use it: check *System Settings → Keyboard → Shortcuts* and either free it there or pick another key in Proxy.

## Where things are stored

Settings and chat history live in `~/.config/Proxy/` (set `PROXY_DATA_DIR` in `.env` to change it).

## Troubleshooting

- **Window doesn't open / sandbox error:** run `npm start -- --no-sandbox` once to check. If that works, it's Electron's Chromium sandbox; fix with `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.
- **Running under Wayland:** Proxy targets X11 (Cinnamon's default). Choose "Cinnamon" (not "Cinnamon on Wayland") at the login screen.

## Development

```bash
npm test     # unit tests (Node's built-in test runner)
```

Contributors: read [CLAUDE.md](CLAUDE.md) (working rules and folder ownership) and [SPEC.md](SPEC.md) (features and interfaces).
