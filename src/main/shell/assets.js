'use strict';

/**
 * Asset files: background images and font files the user imports (SPEC 9.5.5).
 * OWNER: Worker 1. Electron-free so it can be tested with `node --test`; the
 * file dialog and image scaling are passed in by shell/index.js.
 *
 * Layout on disk, inside `dataDir/assets/`:
 *   <id>.json   AssetInfo (+ `file`, the data file's name)
 *   <id>.<ext>  the bytes
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2560;
const MAX_NAME_LENGTH = 120;
const ID_RE = /^[a-f0-9]{24}$/;

const TYPES = Object.freeze({
  image: Object.freeze({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
  }),
  font: Object.freeze({
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  }),
});

const KIND_LABELS = { image: 'Images', font: 'Fonts' };

/** File dialog filters for a kind. */
function dialogFilters(kind) {
  return [{ name: KIND_LABELS[kind], extensions: Object.keys(TYPES[kind]) }];
}

const isKind = (kind) => kind === 'image' || kind === 'font';
const isId = (id) => typeof id === 'string' && ID_RE.test(id);
const newId = () => crypto.randomBytes(12).toString('hex');

/** Lower-case extension without the dot, or ''. */
function extOf(filePath) {
  return path.extname(String(filePath || '')).slice(1).toLowerCase();
}

/** The MIME type for a file of this kind, or null when the extension isn't allowed. */
function mimeFor(kind, filePath) {
  if (!isKind(kind)) return null;
  return TYPES[kind][extOf(filePath)] || null;
}

/** A display name from a path: the base name, no control characters, at most 120 characters. */
function cleanName(filePath) {
  const base = path.basename(String(filePath || '').replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'file').slice(0, MAX_NAME_LENGTH);
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {{
 *   dir: string,                              // dataDir/assets
 *   now?: () => number,
 *   makeId?: () => string,
 *   scaleImage?: (buf: Buffer, mimeType: string, maxSide: number) => ({ data: Buffer, mimeType: string } | null),
 * }} opts
 */
function createAssetStore({ dir, now = Date.now, makeId = newId, scaleImage = null }) {
  const metaPath = (id) => path.join(dir, `${id}.json`);

  function readMeta(id) {
    if (!isId(id)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
      if (!meta || meta.id !== id || !isKind(meta.kind) || typeof meta.file !== 'string') return null;
      if (path.basename(meta.file) !== meta.file || !meta.file.startsWith(`${id}.`)) return null;
      return meta;
    } catch {
      return null;
    }
  }

  const toInfo = ({ id, kind, name, mimeType, bytes, createdAt }) => ({ id, kind, name, mimeType, bytes, createdAt });

  /**
   * Copy a file into the store.
   * @returns {import('../../shared/contracts').AssetInfo}
   * @throws {Error} with a message the user can read.
   */
  function importFile(kind, filePath) {
    if (!isKind(kind)) throw new Error(`Unknown asset kind "${kind}".`);
    let mimeType = mimeFor(kind, filePath);
    if (!mimeType) {
      const allowed = Object.keys(TYPES[kind]).map((e) => `.${e}`).join(', ');
      throw new Error(`That file type isn't supported. Use ${allowed}.`);
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new Error("That file can't be read.");
    }
    if (!stat.isFile()) throw new Error("That isn't a file.");
    if (stat.size > MAX_BYTES) {
      throw new Error(`That file is ${formatMb(stat.size)}. The limit is ${formatMb(MAX_BYTES)}.`);
    }
    if (stat.size === 0) throw new Error('That file is empty.');

    let data = fs.readFileSync(filePath);
    if (kind === 'image' && scaleImage) {
      const scaled = scaleImage(data, mimeType, MAX_IMAGE_SIDE);
      if (scaled && scaled.data && scaled.data.length) {
        data = scaled.data;
        mimeType = scaled.mimeType;
      }
    }

    const id = makeId();
    if (!isId(id)) throw new Error('Could not make an asset id.');
    const ext = Object.keys(TYPES[kind]).find((e) => TYPES[kind][e] === mimeType) || extOf(filePath);
    const meta = {
      id,
      kind,
      name: cleanName(filePath),
      mimeType,
      bytes: data.length,
      createdAt: now(),
      file: `${id}.${ext}`,
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, meta.file), data);
    fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
    return toInfo(meta);
  }

  /** @returns {{ id: string, mimeType: string, dataBase64: string } | null} */
  function get(id) {
    const meta = readMeta(id);
    if (!meta) return null;
    try {
      const data = fs.readFileSync(path.join(dir, meta.file));
      return { id, mimeType: meta.mimeType, dataBase64: data.toString('base64') };
    } catch {
      return null;
    }
  }

  /** Newest first. */
  function list(kind) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => readMeta(n.slice(0, -5)))
      .filter((m) => m && (!kind || m.kind === kind))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toInfo);
  }

  function remove(id) {
    const meta = readMeta(id);
    if (meta) {
      try { fs.unlinkSync(path.join(dir, meta.file)); } catch { /* already gone */ }
      try { fs.unlinkSync(metaPath(id)); } catch { /* already gone */ }
    }
    return { ok: true };
  }

  return { importFile, get, list, delete: remove };
}

/**
 * Pick the new size for an image so neither side is over `maxSide`.
 * @returns {{ width: number, height: number } | null} null when it already fits.
 */
function fitWithin(width, height, maxSide) {
  if (!(width > 0 && height > 0)) return null;
  if (width <= maxSide && height <= maxSide) return null;
  const scale = maxSide / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

module.exports = {
  createAssetStore,
  dialogFilters,
  mimeFor,
  cleanName,
  fitWithin,
  isId,
  MAX_BYTES,
  MAX_IMAGE_SIDE,
};
