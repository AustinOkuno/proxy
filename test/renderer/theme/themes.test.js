import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, validateTheme, allThemes, findTheme, duplicateTheme, exportTheme, importTheme } from '../../../src/renderer/theme/themes.js';
import { COLOR_TOKENS, resolveColors } from '../../../src/renderer/theme/tokens.js';
import { contrast, isHexColor } from '../../../src/renderer/theme/color.js';

test('the four built-in themes from SPEC 9.4, Dungeon first and default', () => {
  assert.deepEqual(BUILTIN_THEMES.map((t) => t.id), ['dungeon', 'neon-night', 'fallen-angel', 'studio']);
  assert.equal(DEFAULT_THEME_ID, 'dungeon');
});

for (const theme of BUILTIN_THEMES) {
  test(`${theme.name}: valid ThemeDef that resolves every color token`, () => {
    assert.ok(validateTheme(theme).ok);
    const c = resolveColors(theme);
    for (const name of COLOR_TOKENS) assert.ok(isHexColor(c[name]), `${name} missing`);
    assert.deepEqual(Object.keys(c).sort(), [...COLOR_TOKENS].sort());
  });

  test(`${theme.name}: text meets the contrast floor`, () => {
    const c = resolveColors(theme);
    const pairs = [
      ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5],
      ['answer-text', 'answer-bg', 4.5],
      ['bubble-user-text', 'bubble-user-bg', 4.5], ['bubble-assistant-text', 'bubble-assistant-bg', 4.5],
      ['bubble-error-text', 'bubble-error-bg', 4.5],
      ['accent-text', 'accent', 4.5], ['code-text', 'code-bg', 4.5], ['math-text', 'bg', 4.5],
      ['text-muted', 'bg', 3], ['text-muted', 'surface', 3], ['accent', 'surface', 3], ['danger', 'bg', 3],
      ['code-keyword', 'code-bg', 3], ['code-string', 'code-bg', 3], ['code-number', 'code-bg', 3],
      ['code-comment', 'code-bg', 3], ['code-function', 'code-bg', 3],
      ['plot-1', 'bg', 3], ['plot-2', 'bg', 3], ['plot-axis', 'bg', 3],
    ];
    for (const [fg, bg, min] of pairs) {
      const r = contrast(c[fg], c[bg]);
      assert.ok(r >= min, `${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}

test('validateTheme rejects junk and drops bad colors and unknown keys', () => {
  assert.equal(validateTheme(null).ok, false);
  assert.equal(validateTheme([]).ok, false);
  assert.equal(validateTheme({ name: '', base: 'dark' }).ok, false);
  assert.equal(validateTheme({ name: 'x', base: 'blue' }).ok, false);
  const v = validateTheme({
    id: 'dungeon', name: '  My   theme ', base: 'dark',
    colors: { bg: '#ABC', text: 'url(javascript:alert(1))', accent: 'red', nope: '#fff', 'plot-1': '#11223344' },
    effects: { scanlines: 5, glow: -1, vignette: 'x' }, radius: 99, extra: true,
  });
  assert.ok(v.ok);
  assert.equal(v.theme.name, 'My theme');
  assert.match(v.theme.id, /^user-[a-z0-9]+$/);
  assert.deepEqual(v.theme.colors, { bg: '#aabbcc', 'plot-1': '#11223344' });
  assert.deepEqual(v.theme.effects, { scanlines: 1, glow: 0, vignette: 0 });
  assert.equal(v.theme.radius, 12);
  assert.equal('extra' in v.theme, false);
});

test('stored user themes keep their id; imports get a new one', () => {
  const t = { id: 'user-abc123', name: 'Mine', base: 'light', colors: {}, effects: {}, radius: 2 };
  assert.equal(validateTheme(t, { keepId: true }).theme.id, 'user-abc123');
  assert.notEqual(validateTheme(t).theme.id, 'user-abc123');
});

test('allThemes and findTheme: built-ins, then valid user themes, unknown id falls back to Dungeon', () => {
  const settings = { appearance: { customThemes: [
    { id: 'user-a1', name: 'A', base: 'dark', colors: {}, effects: {}, radius: 0 },
    { id: 'user-a1', name: 'dup', base: 'dark' },
    { name: 'no base' },
  ] } };
  assert.deepEqual(allThemes(settings).map((t) => t.id), ['dungeon', 'neon-night', 'fallen-angel', 'studio', 'user-a1']);
  assert.equal(findTheme(settings, 'user-a1').name, 'A');
  assert.equal(findTheme(settings, 'gone').id, 'dungeon');
  assert.equal(findTheme({}, undefined).id, 'dungeon');
});

test('duplicate, export and import round trip', () => {
  const copy = duplicateTheme(BUILTIN_THEMES[1], ['Neon Night copy']);
  assert.equal(copy.name, 'Neon Night copy 2');
  assert.match(copy.id, /^user-/);
  const back = importTheme(exportTheme(copy));
  assert.ok(back.ok);
  assert.notEqual(back.theme.id, copy.id);
  assert.deepEqual({ ...back.theme, id: copy.id }, copy);
  assert.equal(importTheme('{oops').ok, false);
});
