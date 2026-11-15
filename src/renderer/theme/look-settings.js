// OWNER: Worker 3. The Look tab of Settings (SPEC 9.2 items 1 to 4, 9.8 W3 steps 2 to 4):
// theme picker, theme editor, effects, fonts per text level, background image.
// Every change shows at once and is saved a moment later through the store.

import { allThemes, duplicateTheme, exportTheme, importTheme, isBuiltin, validateTheme } from './themes.js';
import { CORE_TOKENS, TOKEN_GROUPS, resolveColors } from './tokens.js';
import { BUNDLED_FONTS, FONT_LEVELS, LEVEL_LABELS, familyFromFileName } from './appearance.js';
import { normalizeHex } from './color.js';

const TOKEN_LABELS = {
  bg: 'Background', surface: 'Panels', text: 'Text', 'text-muted': 'Quiet text', accent: 'Accent', 'accent-2': 'Second accent',
};

/** Tiny DOM builder. Attributes starting with "on" become listeners; text is always set as text. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const pct = (n) => `${Math.round(n * 100)}%`;

/** A labelled range input. `onInput` gets the number. */
function slider({ key, label, value, min = 0, max = 1, step = 0.05, format = pct, onInput }) {
  const out = h('output', { class: 'look-slider-value' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value, dataset: { key }, 'aria-label': label,
    oninput: () => {
      const v = Number(input.value);
      out.textContent = format(v);
      onInput(v);
    },
  });
  return h('label', { class: 'look-slider' }, h('span', { class: 'look-slider-label' }, label), input, out);
}

/**
 * @param {HTMLElement} container
 * @param {{ proxy: any, store: any, loadFont: Function }} ctx
 */
export function mountLook(container, { proxy, store, loadFont }) {
  const ui = { confirmDelete: null, note: '', noteKind: 'muted' };

  container.classList.add('look');
  // Enter inside the Look tab must not submit the surrounding settings form.
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
  });

  const say = (text, kind = 'muted') => {
    ui.note = text;
    ui.noteKind = kind;
    const el = container.querySelector('.look-note');
    if (el) {
      el.textContent = text;
      el.className = `look-note ${kind}`;
    }
  };

  /** Re-render, keeping keyboard focus on the same control. */
  function render() {
    const focusedKey = document.activeElement && container.contains(document.activeElement)
      ? document.activeElement.dataset.key : null;
    const a = store.get();
    container.replaceChildren(
      themeSection(a),
      editorSection(a),
      effectsSection(a),
      fontsSection(a),
      backgroundSection(a),
      h('p', { class: `look-note ${ui.noteKind}`, role: 'status' }, ui.note),
      store.state.unsaved
        ? h('p', { class: 'look-note warning' }, 'These look changes show now but are not being saved yet; they reset when Proxy restarts.')
        : null,
    );
    if (focusedKey) {
      const el = container.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (el) el.focus();
    }
  }

  const setTheme = (id) => store.update((a) => ({ ...a, themeId: id }));
  const editCustom = (id, fn, opts) => store.update((a) => ({
    ...a,
    customThemes: a.customThemes.map((t) => (t.id === id ? fn(JSON.parse(JSON.stringify(t))) : t)),
  }), opts);

  // ---- Themes -------------------------------------------------------------
  function themeSection(a) {
    const themes = allThemes({ appearance: a });
    const list = h('div', { class: 'look-themes', role: 'radiogroup', 'aria-label': 'Theme' });
    for (const t of themes) {
      const c = resolveColors(t);
      const swatch = h('span', { class: 'look-swatch', 'aria-hidden': 'true' },
        ...['bg', 'surface', 'text', 'accent', 'accent-2'].map((k) => {
          const s = h('span');
          s.style.background = c[k];
          return s;
        }));
      list.append(h('button', {
        type: 'button',
        class: `look-theme${t.id === a.themeId ? ' active' : ''}`,
        role: 'radio',
        'aria-checked': String(t.id === a.themeId),
        dataset: { key: `theme:${t.id}` },
        onclick: () => setTheme(t.id),
      }, swatch, h('span', { class: 'look-theme-name' }, t.name), isBuiltin(t.id) ? null : h('span', { class: 'look-tag' }, 'yours')));
    }

    const fileInput = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (file.size > 256 * 1024) return say('That theme file is too big.', 'error');
        const res = importTheme(await file.text());
        if (!res.ok) return say(res.error, 'error');
        if (a.customThemes.length >= 50) return say('You have 50 themes already. Delete one first.', 'error');
        store.update((cur) => ({ ...cur, customThemes: [...cur.customThemes, res.theme], themeId: res.theme.id }), { now: true });
        say(`Imported "${res.theme.name}".`);
      },
    });

    const current = themes.find((t) => t.id === a.themeId) || themes[0];
    return h('fieldset', { class: 'look-section' },
      h('legend', {}, 'Theme'),
      list,
      h('div', { class: 'look-actions' },
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: 'theme-duplicate' },
          onclick: () => {
            if (a.customThemes.length >= 50) return say('You have 50 themes already. Delete one first.', 'error');
            const copy = duplicateTheme(current, themes.map((t) => t.name));
            store.update((cur) => ({ ...cur, customThemes: [...cur.customThemes, copy], themeId: copy.id }), { now: true });
            say(`Made "${copy.name}". Edit it below.`);
          },
        }, isBuiltin(current.id) ? 'Duplicate to edit' : 'Duplicate'),
        h('button', { type: 'button', class: 'btn small', dataset: { key: 'theme-import' }, onclick: () => fileInput.click() }, 'Import…'),
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: 'theme-export' },
          onclick: () => {
            const blob = new Blob([exportTheme(current)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = h('a', { href: url, download: `${current.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.proxy-theme.json` });
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          },
        }, 'Export'),
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: 'theme-copy' },
          onclick: async () => {
            try {
              await proxy.clipboard.writeText(exportTheme(current));
              say('Theme JSON copied.');
            } catch {
              say('Couldn\'t copy the theme.', 'error');
            }
          },
        }, 'Copy JSON'),
        fileInput,
      ));
  }

  // ---- Theme editor (user themes only) -------------------------------------
  function editorSection(a) {
    const theme = a.customThemes.map((t) => validateTheme(t, { keepId: true })).find((v) => v.ok && v.theme.id === a.themeId);
    if (!theme) {
      return h('p', { class: 'muted hint look-hint' }, 'Built-in themes stay as they are. Duplicate one to make your own and edit its colors.');
    }
    const t = theme.theme;
    const resolved = resolveColors(t);

    const colorRow = (token) => {
      const explicit = t.colors[token];
      const value = explicit || resolved[token];
      const text = h('input', {
        type: 'text', class: 'look-hex', value, spellcheck: false, maxLength: 9, dataset: { key: `hex:${token}` },
        'aria-label': `${TOKEN_LABELS[token] || token} hex`,
        oninput: () => {
          const hex = normalizeHex(text.value);
          text.classList.toggle('invalid', !hex);
          if (!hex) return;
          picker.value = hex.slice(0, 7);
          editCustom(t.id, (x) => ({ ...x, colors: { ...x.colors, [token]: hex } }));
        },
      });
      const picker = h('input', {
        type: 'color', value: value.slice(0, 7), dataset: { key: `color:${token}` },
        'aria-label': TOKEN_LABELS[token] || token,
        oninput: () => {
          text.value = picker.value;
          text.classList.remove('invalid');
          editCustom(t.id, (x) => ({ ...x, colors: { ...x.colors, [token]: picker.value } }));
        },
      });
      const reset = explicit && !CORE_TOKENS.includes(token)
        ? h('button', {
          type: 'button', class: 'btn small', title: 'Go back to the color worked out from the main colors', dataset: { key: `reset:${token}` },
          onclick: () => {
            editCustom(t.id, (x) => {
              const colors = { ...x.colors };
              delete colors[token];
              return { ...x, colors };
            });
            render();
          },
        }, 'Auto')
        : null;
      return h('div', { class: 'look-color' },
        picker,
        h('span', { class: 'look-color-name' }, TOKEN_LABELS[token] || token),
        text, reset);
    };

    const groups = TOKEN_GROUPS.map((g, i) => {
      const rows = g.tokens.map(colorRow);
      if (i === 0) return h('div', { class: 'look-colors' }, rows);
      return h('details', { class: 'look-group' }, h('summary', {}, g.label), h('div', { class: 'look-colors' }, rows));
    });

    const nameInput = h('input', {
      type: 'text', class: 'look-name', value: t.name, maxLength: 40, dataset: { key: 'theme-name' }, 'aria-label': 'Theme name',
      oninput: () => {
        const name = nameInput.value.replace(/\s+/g, ' ').trim();
        if (name) editCustom(t.id, (x) => ({ ...x, name }));
      },
      onchange: () => render(),
    });

    const deleting = ui.confirmDelete === t.id;
    return h('fieldset', { class: 'look-section' },
      h('legend', {}, 'Edit theme'),
      h('div', { class: 'look-row' },
        h('label', { class: 'look-field' }, h('span', {}, 'Name'), nameInput),
        h('label', { class: 'look-field' }, h('span', {}, 'Base'),
          h('select', {
            dataset: { key: 'theme-base' },
            onchange: (e) => editCustom(t.id, (x) => ({ ...x, base: e.target.value })),
          }, ...['dark', 'light'].map((b) => h('option', { value: b, selected: t.base === b }, b))))),
      groups,
      h('div', { class: 'look-sliders' },
        slider({ key: 'theme-scanlines', label: 'Scanlines', value: t.effects.scanlines, onInput: (v) => editCustom(t.id, (x) => ({ ...x, effects: { ...x.effects, scanlines: v } })) }),
        slider({ key: 'theme-glow', label: 'Glow', value: t.effects.glow, onInput: (v) => editCustom(t.id, (x) => ({ ...x, effects: { ...x.effects, glow: v } })) }),
        slider({ key: 'theme-vignette', label: 'Vignette', value: t.effects.vignette, onInput: (v) => editCustom(t.id, (x) => ({ ...x, effects: { ...x.effects, vignette: v } })) }),
        slider({ key: 'theme-radius', label: 'Corners', value: t.radius, min: 0, max: 12, step: 1, format: (v) => `${v}px`, onInput: (v) => editCustom(t.id, (x) => ({ ...x, radius: v })) })),
      h('div', { class: 'look-actions' },
        h('button', {
          type: 'button', class: `btn small${deleting ? ' danger' : ''}`, dataset: { key: 'theme-delete' },
          onclick: () => {
            if (!deleting) {
              ui.confirmDelete = t.id;
              render();
              return;
            }
            ui.confirmDelete = null;
            store.update((cur) => ({ ...cur, customThemes: cur.customThemes.filter((x) => x.id !== t.id), themeId: 'dungeon' }), { now: true });
            say(`Deleted "${t.name}".`);
          },
        }, deleting ? 'Press again to delete' : 'Delete theme')));
  }

  // ---- Effects ---------------------------------------------------------------
  function effectsSection(a) {
    const theme = allThemes({ appearance: a }).find((t) => t.id === a.themeId) || allThemes({})[0];
    const fx = a.effects || theme.effects;
    const set = (k) => (v) => store.update((cur) => ({ ...cur, effects: { ...(cur.effects || theme.effects), [k]: v } }));
    return h('fieldset', { class: 'look-section' },
      h('legend', {}, 'Effects'),
      h('p', { class: 'muted hint' }, 'Each theme has its own levels. Moving a slider sets yours for every theme until you switch back.'),
      h('div', { class: 'look-sliders' },
        slider({ key: 'fx-scanlines', label: 'Scanlines', value: fx.scanlines, onInput: set('scanlines') }),
        slider({ key: 'fx-glow', label: 'Glow', value: fx.glow, onInput: set('glow') }),
        slider({ key: 'fx-vignette', label: 'Vignette', value: fx.vignette, onInput: set('vignette') })),
      h('div', { class: 'look-actions' }, h('button', {
        type: 'button', class: 'btn small', dataset: { key: 'fx-reset' },
        onclick: () => {
          store.update((cur) => ({ ...cur, effects: null }), { now: true });
          render();
        },
      }, 'Use the theme\'s effects')));
  }

  // ---- Fonts -----------------------------------------------------------------
  function fontsSection(a) {
    const listId = 'look-font-families';
    const families = [...BUNDLED_FONTS, ...a.customFonts.map((f) => f.family)];
    const datalist = h('datalist', { id: listId }, ...[...new Set(families)].map((f) => h('option', { value: f })));

    const rows = FONT_LEVELS.map((level) => {
      const f = a.fonts[level];
      const setFont = (patch) => store.update((cur) => ({ ...cur, fonts: { ...cur.fonts, [level]: { ...cur.fonts[level], ...patch } } }));
      const family = h('input', {
        type: 'text', list: listId, value: f.family, maxLength: 100, spellcheck: false, dataset: { key: `font-family:${level}` },
        'aria-label': `${LEVEL_LABELS[level]} font`, placeholder: 'Font name',
        oninput: () => {
          if (family.value.trim()) setFont({ family: family.value });
        },
      });
      const size = h('input', {
        type: 'number', min: 10, max: 40, step: 1, value: f.size, class: 'look-num', dataset: { key: `font-size:${level}` },
        'aria-label': `${LEVEL_LABELS[level]} size in px`,
        oninput: () => {
          const n = Number(size.value);
          if (n >= 10 && n <= 40) setFont({ size: n });
        },
      });
      const weight = 'weight' in f
        ? h('select', {
          'aria-label': `${LEVEL_LABELS[level]} weight`, dataset: { key: `font-weight:${level}` },
          onchange: (e) => setFont({ weight: Number(e.target.value) }),
        }, ...[300, 400, 500, 600, 700, 800].map((w) => h('option', { value: w, selected: f.weight === w }, String(w))))
        : h('span', { class: 'look-weight-none' });
      const sample = h('span', { class: `look-sample look-sample-${level}` }, level === 'code' ? 'pH = -log[H+]' : 'Aa 2H2 + O2');
      return h('div', { class: 'look-font' }, h('span', { class: 'look-font-level' }, LEVEL_LABELS[level]), family, size, weight, sample);
    });

    const custom = a.customFonts.length
      ? h('ul', { class: 'look-custom-fonts' }, ...a.customFonts.map((f) => h('li', {},
        h('span', {}, f.family),
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: `font-remove:${f.assetId}` },
          onclick: async () => {
            store.update((cur) => ({ ...cur, customFonts: cur.customFonts.filter((x) => x.assetId !== f.assetId) }), { now: true });
            try {
              await proxy.assets.delete(f.assetId);
            } catch { /* already gone */ }
          },
        }, 'Remove'))))
      : null;

    return h('fieldset', { class: 'look-section' },
      h('legend', {}, 'Fonts'),
      h('p', { class: 'muted hint' }, 'Pick a bundled font, type the name of any font on this computer, or import a .ttf, .otf or .woff2 file.'),
      datalist,
      h('div', { class: 'look-fonts' }, rows),
      custom,
      h('div', { class: 'look-actions' },
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: 'font-import' },
          onclick: async () => {
            if (a.customFonts.length >= 20) return say('You can import up to 20 fonts. Remove one first.', 'error');
            let info;
            try {
              info = await proxy.assets.import('font');
            } catch (err) {
              return say(`Couldn't import the font: ${err && err.message ? err.message : err}`, 'error');
            }
            if (!info) return;
            const fam = familyFromFileName(info.name);
            const added = { assetId: info.id, family: fam };
            loadFont(added);
            store.update((cur) => ({ ...cur, customFonts: [...cur.customFonts, added] }), { now: true });
            say(`Added "${fam}". Pick it for any text level above.`);
          },
        }, 'Import font file…'),
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: 'font-reset' },
          onclick: () => store.update((cur) => ({ ...cur, fonts: {} }), { now: true }),
        }, 'Reset fonts')));
  }

  // ---- Background --------------------------------------------------------------
  function backgroundSection(a) {
    const b = a.background;
    const setBg = (patch, opts) => store.update((cur) => ({ ...cur, background: { ...cur.background, ...patch } }), opts);
    return h('fieldset', { class: 'look-section' },
      h('legend', {}, 'Background image'),
      h('p', { class: 'muted hint' }, b.assetId ? 'Your image sits behind the chat. Dim keeps the text readable.' : 'No image yet. Proxy ships without images; add your own.'),
      h('div', { class: 'look-actions' },
        h('button', {
          type: 'button', class: 'btn small', dataset: { key: 'bg-choose' },
          onclick: async () => {
            let info;
            try {
              info = await proxy.assets.import('image');
            } catch (err) {
              return say(`Couldn't add the image: ${err && err.message ? err.message : err}`, 'error');
            }
            if (!info) return;
            const old = store.get().background.assetId;
            setBg({ assetId: info.id }, { now: true });
            if (old && old !== info.id) proxy.assets.delete(old).catch(() => {});
          },
        }, b.assetId ? 'Change image…' : 'Choose image…'),
        b.assetId
          ? h('button', {
            type: 'button', class: 'btn small', dataset: { key: 'bg-remove' },
            onclick: () => {
              const old = b.assetId;
              setBg({ assetId: null }, { now: true });
              proxy.assets.delete(old).catch(() => {});
            },
          }, 'Remove image')
          : null),
      b.assetId
        ? h('div', { class: 'look-sliders' },
          h('label', { class: 'look-slider' }, h('span', { class: 'look-slider-label' }, 'Fit'),
            h('select', {
              dataset: { key: 'bg-fit' },
              onchange: (e) => setBg({ fit: e.target.value }),
            }, ...[['cover', 'Fill'], ['contain', 'Fit whole image'], ['auto', 'Actual size']].map(([v, l]) => h('option', { value: v, selected: b.fit === v }, l)))),
          slider({ key: 'bg-dim', label: 'Dim', value: b.dim, onInput: (v) => setBg({ dim: v }) }),
          slider({ key: 'bg-blur', label: 'Blur', value: b.blur, min: 0, max: 20, step: 1, format: (v) => `${v}px`, onInput: (v) => setBg({ blur: v }) }))
        : null);
  }

  // Structural changes (from here or elsewhere) re-render; slider and color drags don't.
  let lastShape = '';
  const shape = (a) => JSON.stringify([
    a.themeId, a.customThemes.map((t) => [t.id, t.base]), a.customFonts, a.background.assetId, store.state.unsaved,
  ]);
  store.subscribe((a, origin) => {
    const s = shape(a);
    if (origin === 'external' || s !== lastShape) {
      if (origin === 'external' && container.contains(document.activeElement) && s === lastShape) return;
      lastShape = s;
      render();
    }
  });
  lastShape = shape(store.get());
  render();
}
