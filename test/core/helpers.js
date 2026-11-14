'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-core-test-'));
}

/** Logger that records warnings instead of printing them. */
function quietLogger() {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
}

module.exports = { tmpDir, quietLogger };
