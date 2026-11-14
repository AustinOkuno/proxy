'use strict';

/**
 * Screen grabbing with desktopCapturer (works in the main process on X11).
 */

const { desktopCapturer, screen } = require('electron');
const { pickScreenSource, scaleRectToImage } = require('./geometry');

/** The display the mouse pointer is on. */
function displayUnderCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * Grab one display as a nativeImage at (close to) native resolution.
 * @param {Electron.Display} display
 * @returns {Promise<Electron.NativeImage>}
 */
async function grabDisplay(display) {
  const displays = screen.getAllDisplays();

  // First call without thumbnails just to learn how the sources are laid out.
  const meta = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  const pick = pickScreenSource(meta, displays, display);
  if (!pick) throw new Error('No screen to capture was found.');

  const scale = pick.combined
    ? Math.max(...displays.map((d) => d.scaleFactor || 1))
    : display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.round(pick.area.width * scale),
    height: Math.round(pick.area.height * scale),
  };

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const src = sources.find((s) => s.id === pick.sourceId) || sources[0];
  if (!src || src.thumbnail.isEmpty()) {
    throw new Error('Screen capture returned an empty image. Is this an X11 session?');
  }

  let image = src.thumbnail;
  if (pick.crop) {
    const r = scaleRectToImage(pick.crop, pick.area, image.getSize());
    if (!r) throw new Error('Could not find this monitor inside the captured screen.');
    image = image.crop(r);
  }
  return image;
}

/**
 * Crop a display image by a DIP rect (relative to the display's top-left).
 * @returns {Electron.NativeImage|null}
 */
function cropToSelection(image, display, rect) {
  const r = scaleRectToImage(rect, display.bounds, image.getSize());
  return r ? image.crop(r) : null;
}

/** nativeImage -> contracts ImageData (PNG). */
function toImageData(image) {
  const { width, height } = image.getSize();
  return { mimeType: 'image/png', dataBase64: image.toPNG().toString('base64'), width, height };
}

module.exports = { displayUnderCursor, grabDisplay, cropToSelection, toImageData };
