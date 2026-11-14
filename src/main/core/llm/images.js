'use strict';

/**
 * Shrink big screenshots before they're sent to the model. A full 4K screenshot
 * is several MB of base64 on every turn of the chat; Gemini doesn't read text
 * any better past ~2000 px, and smaller uploads fail and time out less.
 * Only the copy sent to the model is shrunk; history keeps the original.
 */

const crypto = require('node:crypto');

const MAX_SIDE = 2048;
const JPEG_OVER_BYTES = 3 * 1024 * 1024; // still huge after resizing: send JPEG instead
const CACHE_SIZE = 32;

/** Electron's nativeImage in the main process; null under plain Node (tests). */
function electronNativeImage() {
  try {
    const electron = require('electron');
    return (electron && typeof electron === 'object' && electron.nativeImage) || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ nativeImage: any, maxSide?: number, logger?: Pick<Console,'warn'> }} opts
 * @returns {(img: { mimeType: string, dataBase64: string }) => { mimeType: string, dataBase64: string }}
 */
function createImageShrinker({ nativeImage, maxSide = MAX_SIDE, logger = console }) {
  if (!nativeImage) return (img) => img;
  const cache = new Map();

  function shrink(img) {
    if (!img || typeof img.dataBase64 !== 'string') return img;
    const buf = Buffer.from(img.dataBase64, 'base64');
    const image = nativeImage.createFromBuffer(buf);
    if (!image || image.isEmpty()) return img;
    const { width, height } = image.getSize();
    if (Math.max(width, height) <= maxSide && buf.length <= JPEG_OVER_BYTES) return img;

    const scale = Math.min(1, maxSide / Math.max(width, height));
    const resized = scale < 1
      ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
      : image;
    let out = resized.toPNG();
    let mimeType = 'image/png';
    if (out.length > JPEG_OVER_BYTES) {
      out = resized.toJPEG(90);
      mimeType = 'image/jpeg';
    }
    const size = resized.getSize();
    return { mimeType, dataBase64: out.toString('base64'), width: size.width, height: size.height };
  }

  return (img) => {
    if (!img || typeof img.dataBase64 !== 'string') return img;
    const key = crypto.createHash('sha1').update(img.dataBase64).digest('hex');
    if (cache.has(key)) return cache.get(key);
    let out = img;
    try {
      out = shrink(img);
    } catch (err) {
      logger.warn(`[core] could not shrink image: ${err.message}`);
    }
    cache.set(key, out);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return out;
  };
}

module.exports = { createImageShrinker, electronNativeImage, MAX_SIDE };
