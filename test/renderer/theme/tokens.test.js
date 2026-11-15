import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildVariables, fontStack, cleanFamily, glowShadow, resolveColors, COLOR_TOKENS } from '../../../src/renderer/theme/tokens.js';
import { BUILTIN_THEMES } from '../../../src/renderer/theme/themes.js';
import { DEFAULT_FONTS, normalizeAppearance, canonical, familyFromFileName, cleanFont } from '../../../src/renderer/theme/appearance.js';
import { contrast, mix, normalizeHex, withAlpha } from '../../../src/renderer/theme/color.js';

const SPEC_TOKENS = `--bg --surface --surface-2 --surface-hover --border --text --text-muted
  --accent --accent-2 --accent-text --danger --danger-bg --warning --success
  --focus-ring --selection-bg --overlay-shadow --drop-target-bg --drop-target-border
  --answer-bg --answer-text --answer-border --answer-glow
  --bubble-user-bg --bubble-user-text --bubble-assistant-bg --bubble-assistant-text
  --bubble-error-bg --bubble-error-text
  --code-bg --code-text --code-keyword --code-string --code-number --code-comment
  --code-function --math-text
  --plot-axis --plot-grid --plot-1 --plot-2 --plot-3 --plot-4
  --glow --scanline-opacity --vignette-opacity --bg-image --bg-dim --bg-blur --bg-fit
  --font-title --font-ui --font-answer --font-explanation --font-body --font-code
  --size-title --size-ui --size-answer --size-explanation --size-body --size-code
  --weight-title --weight-answer --radius --radius-small`.split(/\s+/).filter(Boolean);

test('color helpers', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('#aabbccff'), '#aabbcc');
  assert.equal(normalizeHex('red'), null);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(withAlpha('#102030', 0.5), '#10203080');
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
});

for (const theme of BUILTIN_THEMES) {
  test(`${theme.name}: the engine sets every SPEC 9.5.1 token`, () => {
    const vars = buildVariables({ theme, fonts: DEFAULT_FONTS });
    for (const t of SPEC_TOKENS) assert.ok(vars[t] !== undefined && vars[t] !== '', `${t} missing`);
  });
}

test('a user theme with only a few colors still resolves every token', () => {
  const c = resolveColors({ base: 'light', colors: { accent: '#0055aa' } });
  for (const name of COLOR_TOKENS) assert.ok(normalizeHex(c[name]), name);
  assert.equal(c['drop-target-border'], '#0055aa');
  assert.ok(contrast(c['accent-text'], c.accent) >= 4.5);
});

test('effects: theme values, user override, and glow off means none', () => {
  const dungeon = BUILTIN_THEMES[0];
  let v = buildVariables({ theme: dungeon });
  assert.equal(v['--glow'], 'none');
  assert.equal(v['--scanline-opacity'], String(dungeon.effects.scanlines));
  v = buildVariables({ theme: dungeon, effects: { scanlines: 0, glow: 1, vignette: 0.5 } });
  assert.equal(v['--scanline-opacity'], '0');
  assert.match(v['--glow'], /^0 0 [\d.]+px rgba\(/);
  assert.equal(glowShadow('#ffffff', 0), 'none');
});

test('background: data URL only, quotes stripped, values clamped', () => {
  const theme = BUILTIN_THEMES[1];
  let v = buildVariables({ theme, background: { fit: 'contain', dim: 3, blur: 50 } });
  assert.equal(v['--bg-image'], 'none');
  assert.equal(v['--bg-dim'], '1');
  assert.equal(v['--bg-blur'], '20px');
  assert.equal(v['--bg-fit'], 'contain');
  v = buildVariables({ theme, background: { fit: 'weird' }, bgImageUrl: 'data:image/png;base64,AA"A)' });
  assert.equal(v['--bg-image'], 'url("data:image/png;base64,AAA)")');
  assert.equal(v['--bg-fit'], 'cover');
});

test('fonts: stacks, cleaning and size limits', () => {
  assert.equal(cleanFamily('Comic"; } body { x'), 'Comic body x');
  assert.equal(fontStack('code', 'Fira Code').split(', ')[0], '"Fira Code"');
  assert.ok(fontStack('body', '').includes('sans-serif'));
  assert.equal(fontStack('ui', 'JetBrains Mono').match(/JetBrains Mono/g).length, 1);
  const v = buildVariables({ theme: BUILTIN_THEMES[0], fonts: { ...DEFAULT_FONTS, answer: { family: 'X', size: 99, weight: 650 } } });
  assert.equal(v['--size-answer'], '40px');
  assert.equal(v['--weight-answer'], '700');
  assert.equal(cleanFont('body', { family: '', size: 2 }).size, 10);
  assert.equal(cleanFont('ui', { family: 'A', weight: 900 }).weight, undefined);
});

test('normalizeAppearance fills defaults and drops junk', () => {
  const a = normalizeAppearance({ themeId: '', fonts: { code: { family: 'Iosevka', size: 15 } }, customFonts: [{ assetId: 'f1', family: 'Pix' }, { family: 'no id' }], effects: { glow: 2 }, background: { dim: -1, fit: 'x', assetId: '' } });
  assert.equal(a.themeId, 'dungeon');
  assert.deepEqual(a.fonts.code, { family: 'Iosevka', size: 15 });
  assert.deepEqual(a.fonts.title, DEFAULT_FONTS.title);
  assert.deepEqual(a.customFonts, [{ assetId: 'f1', family: 'Pix' }]);
  assert.deepEqual(a.effects, { scanlines: 0, glow: 1, vignette: 0 });
  assert.deepEqual(a.background, { assetId: null, fit: 'cover', dim: 0, blur: 0 });
  assert.equal(normalizeAppearance(undefined).effects, null);
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: 3 }] }), canonical({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(familyFromFileName('Press_Start-2P.ttf'), 'Press Start 2P');
});

test('styles/theme.css fallback block equals the Dungeon values the engine computes', () => {
  const css = fs.readFileSync(new URL('../../../src/renderer/styles/theme.css', import.meta.url), 'utf8');
  const block = css.split('/* BEGIN ENGINE TOKENS */')[1].split('/* END ENGINE TOKENS */')[0];
  const fromCss = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  assert.deepEqual(fromCss, buildVariables({ theme: BUILTIN_THEMES[0], fonts: DEFAULT_FONTS }));
});

test('every bundled font file referenced by fonts.css exists, with its OFL license', () => {
  const dir = new URL('../../../src/renderer/assets/fonts/', import.meta.url);
  const css = fs.readFileSync(new URL('fonts.css', dir), 'utf8');
  const files = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 9);
  for (const f of files) {
    assert.ok(fs.existsSync(new URL(f, dir)), f);
    assert.ok(fs.existsSync(new URL(`${f.split('/')[0]}/OFL.txt`, dir)), `${f} license`);
  }
});
