'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createAssetStore, dialogFilters, mimeFor, cleanName, fitWithin, isId, MAX_BYTES,
} = require('../../src/main/shell/assets');

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-assets-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  return { root, src, dir: path.join(root, 'data', 'assets') };
}

function write(dir, name, bytes) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

test('mimeFor allows only the types for each kind', () => {
  assert.equal(mimeFor('image', '/a/b/Cat.PNG'), 'image/png');
  assert.equal(mimeFor('image', 'x.jpeg'), 'image/jpeg');
  assert.equal(mimeFor('image', 'x.webp'), 'image/webp');
  assert.equal(mimeFor('font', 'x.woff2'), 'font/woff2');
  assert.equal(mimeFor('font', 'x.otf'), 'font/otf');
  assert.equal(mimeFor('image', 'x.ttf'), null);
  assert.equal(mimeFor('font', 'x.png'), null);
  assert.equal(mimeFor('image', 'x.svg'), null);
  assert.equal(mimeFor('video', 'x.png'), null);
});

test('dialogFilters lists the extensions without dots', () => {
  assert.deepEqual(dialogFilters('font')[0].extensions, ['ttf', 'otf', 'woff', 'woff2']);
  assert.ok(dialogFilters('image')[0].extensions.includes('jpg'));
});

test('cleanName keeps the base name, drops control characters, caps length', () => {
  assert.equal(cleanName('/home/me/Pictures/sky.png'), 'sky.png');
  assert.equal(cleanName('C:\\Users\\me\\sky.png'), 'sky.png');
  assert.equal(cleanName('/x/a\u0000b\nc.png'), 'abc.png');
  assert.equal(cleanName(`/x/${'a'.repeat(300)}.png`).length, 120);
  assert.equal(cleanName(''), 'file');
});

test('fitWithin scales the long side down to the limit', () => {
  assert.equal(fitWithin(2560, 1440, 2560), null);
  assert.deepEqual(fitWithin(5120, 2880, 2560), { width: 2560, height: 1440 });
  assert.deepEqual(fitWithin(1000, 4000, 2560), { width: 640, height: 2560 });
  assert.equal(fitWithin(0, 10, 2560), null);
});

test('ids are 24 hex characters and nothing else', () => {
  assert.ok(isId('0123456789abcdef01234567'));
  assert.ok(!isId('../../etc/passwd'));
  assert.ok(!isId('0123456789abcdef0123456'));
  assert.ok(!isId(null));
});

test('import, get, list and delete round-trip, and survive a new store (restart)', () => {
  const { src, dir } = tmp();
  let t = 1000;
  const store = createAssetStore({ dir, now: () => t++ });
  const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const img = store.importFile('image', write(src, 'sky.png', imgBytes));
  assert.ok(isId(img.id));
  assert.deepEqual(img, { id: img.id, kind: 'image', name: 'sky.png', mimeType: 'image/png', bytes: 7, createdAt: 1000 });
  const font = store.importFile('font', write(src, 'Mono.woff2', Buffer.from('wOF2data')));

  const again = createAssetStore({ dir });
  const got = again.get(img.id);
  assert.equal(got.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(got.dataBase64, 'base64'), imgBytes);
  assert.deepEqual(again.list().map((a) => a.id), [font.id, img.id]);
  assert.deepEqual(again.list('image').map((a) => a.id), [img.id]);

  assert.deepEqual(again.delete(img.id), { ok: true });
  assert.equal(again.get(img.id), null);
  assert.deepEqual(again.list().map((a) => a.id), [font.id]);
  assert.deepEqual(again.delete(img.id), { ok: true }); // already gone is fine
});

test('get and delete ignore ids that could escape the folder', () => {
  const { dir } = tmp();
  const store = createAssetStore({ dir });
  assert.equal(store.get('../secrets'), null);
  assert.deepEqual(store.delete('../secrets'), { ok: true });
});

test('refuses wrong types, empty files and files over 15 MB with readable errors', () => {
  const { src, dir } = tmp();
  const store = createAssetStore({ dir });
  assert.throws(() => store.importFile('image', write(src, 'x.ttf', 'abc')), /isn't supported\. Use \.png/);
  assert.throws(() => store.importFile('image', write(src, 'e.png', '')), /empty/);
  assert.throws(() => store.importFile('image', path.join(src, 'missing.png')), /can't be read/);
  const big = path.join(src, 'big.png');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, MAX_BYTES + 1);
  assert.throws(() => store.importFile('image', big), /The limit is 15\.0 MB/);
  assert.throws(() => store.importFile('video', write(src, 'v.png', 'x')), /Unknown asset kind/);
  assert.deepEqual(store.list(), []);
});

test('images go through scaleImage; fonts do not', () => {
  const { src, dir } = tmp();
  const calls = [];
  const store = createAssetStore({
    dir,
    scaleImage: (buf, mime, max) => {
      calls.push([mime, max]);
      return { data: Buffer.from('small'), mimeType: 'image/jpeg' };
    },
  });
  const img = store.importFile('image', write(src, 'big.jpg', 'a-very-large-jpeg'));
  assert.equal(img.bytes, 5);
  assert.equal(Buffer.from(store.get(img.id).dataBase64, 'base64').toString(), 'small');
  store.importFile('font', write(src, 'f.ttf', 'font'));
  assert.deepEqual(calls, [['image/jpeg', 2560]]);
});

test('a scaleImage that returns null keeps the original bytes', () => {
  const { src, dir } = tmp();
  const store = createAssetStore({ dir, scaleImage: () => null });
  const img = store.importFile('image', write(src, 'a.gif', 'GIF89a'));
  assert.equal(img.mimeType, 'image/gif');
  assert.equal(Buffer.from(store.get(img.id).dataBase64, 'base64').toString(), 'GIF89a');
});
