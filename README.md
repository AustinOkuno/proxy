# Proxy

A desktop assistant for Linux Mint Cinnamon. Press a hotkey, drag a box around anything on your screen, and ask Gemini about it in a floating chat panel. Runs entirely on your machine; the only network call is to the Gemini API.

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
3. **Add your Gemini key.** Get a free key at <https://aistudio.google.com/apikey>, then:
   ```bash
   cp .env.example .env
   nano .env        # paste your key after GEMINI_API_KEY=
   ```
   `.env` is gitignored, so your key never gets committed.
4. **Run it:**
   ```bash
   npm start
   ```

## Default hotkeys

| Action | Keys |
|---|---|
| Region snip | `Super+Shift+S` |
| Full screenshot | `Super+Shift+A` |
| Show/hide panel (when visibility is "toggle") | `Super+Shift+P` |

**Super** is the Windows key. All hotkeys can be changed in the app's settings. If a hotkey doesn't work, Cinnamon may already use it: check *System Settings → Keyboard → Shortcuts* and either free it there or pick another key in Proxy.

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
