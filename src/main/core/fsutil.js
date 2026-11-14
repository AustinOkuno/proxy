'use strict';

/**
 * Small file helpers for the core stores. Electron-free.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Read and parse a JSON file.
 * @returns {{ ok: true, value: any } | { ok: false, missing: boolean, error?: Error }}
 */
function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, missing: true };
    return { ok: false, missing: false, error: err };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, missing: false, error: err };
  }
}

/** Write JSON atomically: write a temp file next to the target, then rename over it. */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/** Move a corrupt file aside so it is not lost and does not break the next start. */
function quarantine(file) {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
  } catch { /* ignore */ }
}

module.exports = { readJson, writeJsonAtomic, quarantine };
