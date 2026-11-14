'use strict';

/**
 * Snip overlay preload (sandboxed). Private to Worker 1; uses only `overlay:` channels.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  /** -> Promise<{ imageUrl: string, width: number, height: number }> (width/height in DIP) */
  getImage: () => ipcRenderer.invoke('overlay:get-image'),
  /** Backdrop image has painted; main can show the window now. */
  ready: () => ipcRenderer.send('overlay:ready'),
  /** rect in DIP, relative to the overlay's top-left. */
  select: (rect) => ipcRenderer.send('overlay:select', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
});
