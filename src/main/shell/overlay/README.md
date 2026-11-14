# Snip overlay (Worker 1)

The region-snip overlay window: `overlay.js` (main side), `overlay.html`,
`overlay-renderer.js`, `overlay.css` and its own sandboxed `overlay-preload.js`.
It is private to Worker 1 and does not use `window.proxy`. Its IPC uses only
`overlay:` channels, scoped to the overlay's own `webContents.ipc`.

Flow: main grabs the display under the cursor, opens a full-display window
showing that screenshot dimmed, the user drags a box (Esc or right-click
cancels), the page sends the rect in DIP, and main crops the original
full-resolution image.
