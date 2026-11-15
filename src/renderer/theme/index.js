// OWNER: Worker 3 (UI phase). Theme engine, built-in themes, fonts, backgrounds (SPEC 9.4, 9.5).
// Keep the exported shape: mountTheme, mountLookSettings, listThemes.

import { registerCommand } from '../keys/index.js';
import { buildVariables, cleanFamily } from './tokens.js';
import { allThemes, findTheme } from './themes.js';
import { canonical, normalizeAppearance } from './appearance.js';
import { mountLook } from './look-settings.js';

const SAVE_DELAY_MS = 300;

/**
 * One store for the look, shared by the engine and the Look tab.
 * Edits apply to the screen at once and are saved shortly after. If the
 * settings store doesn't keep the change (older core without appearance
 * validation), the change stays on screen for this session and `unsaved` is set.
 */
function createStore(proxy) {
  let settings = {};
  let local = null; // appearance edited here and not yet confirmed by the settings store
  let inFlight = 0;
  let saveTimer = null;
  let saver = (patch) => proxy.settings.update(patch);
  const listeners = new Set();
  const state = { unsaved: false };

  const appearance = () => normalizeAppearance(local || settings.appearance);
  const emit = (origin) => {
    for (const cb of [...listeners]) {
      try {
        cb(appearance(), origin);
      } catch (err) {
        console.warn('[theme] listener failed:', err);
      }
    }
  };

  async function flush() {
    saveTimer = null;
    if (!local) return;
    const sent = local;
    inFlight += 1;
    try {
      const returned = await saver({ appearance: sent });
      if (returned && returned.appearance && canonical(normalizeAppearance(returned.appearance)) === canonical(normalizeAppearance(sent))) {
        if (local === sent) local = null;
        settings = returned;
        state.unsaved = false;
      } else {
        state.unsaved = true;
      }
    } catch (err) {
      console.warn('[theme] saving the look failed:', err);
      state.unsaved = true;
    } finally {
      inFlight -= 1;
    }
    emit('saved');
  }

  return {
    state,
    get: appearance,
    settings: () => settings,
    setSaver(fn) {
      if (typeof fn === 'function') saver = fn;
    },
    /** Settings from the app (load or broadcast). */
    receive(next) {
      if (!next || typeof next !== 'object') return;
      settings = next;
      if (local && inFlight === 0 && !saveTimer && canonical(normalizeAppearance(next.appearance)) === canonical(normalizeAppearance(local))) {
        local = null;
        state.unsaved = false;
      }
      if (!local) emit('external');
    },
    /** Change the look: `fn` gets a copy of the appearance and returns the new one. */
    update(fn, { now = false } = {}) {
      const draft = JSON.parse(JSON.stringify(appearance()));
      local = normalizeAppearance(fn(draft) || draft);
      emit('local');
      if (saveTimer) clearTimeout(saveTimer);
      if (now) flush();
      else saveTimer = setTimeout(flush, SAVE_DELAY_MS);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

// --- Engine: CSS variables, imported fonts, background image ----------------

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function createEngine(proxy, store) {
  const root = document.documentElement;
  const fontFaces = new Map(); // assetId -> Promise<FontFace|null>
  const bg = { assetId: null, url: null, loading: null };
  let lastVars = {};

  function loadFont({ assetId, family }) {
    const key = `${assetId}|${family}`;
    if (!fontFaces.has(key)) {
      fontFaces.set(key, (async () => {
        try {
          const data = await proxy.assets.get(assetId);
          if (!data || !data.dataBase64) return null;
          const face = new FontFace(cleanFamily(family), base64ToBuffer(data.dataBase64));
          await face.load();
          document.fonts.add(face);
          return face;
        } catch (err) {
          console.warn(`[theme] could not load font "${family}":`, err);
          fontFaces.delete(key);
          return null;
        }
      })());
    }
    return fontFaces.get(key);
  }

  async function loadBackground(assetId) {
    if (bg.assetId === assetId && (bg.url || bg.loading)) return;
    bg.assetId = assetId;
    bg.url = null;
    if (!assetId) return;
    const loading = (async () => {
      try {
        const data = await proxy.assets.get(assetId);
        if (bg.assetId !== assetId) return;
        if (!data || !data.dataBase64 || !/^image\/[a-z0-9.+-]+$/i.test(data.mimeType || '')) {
          // The image is gone (deleted elsewhere): clear it from the look.
          if (data === null) store.update((a) => ({ ...a, background: { ...a.background, assetId: null } }), { now: true });
          return;
        }
        bg.url = `data:${data.mimeType};base64,${data.dataBase64}`;
        apply(store.get());
      } catch (err) {
        console.warn('[theme] could not load the background image:', err);
      } finally {
        if (bg.assetId === assetId) bg.loading = null;
      }
    })();
    bg.loading = loading;
  }

  function apply(appearance) {
    const theme = findTheme({ appearance }, appearance.themeId);
    const vars = buildVariables({
      theme,
      fonts: appearance.fonts,
      effects: appearance.effects,
      background: appearance.background,
      bgImageUrl: appearance.background.assetId && bg.assetId === appearance.background.assetId ? bg.url : null,
    });
    for (const name of Object.keys(lastVars)) {
      if (!(name in vars)) root.style.removeProperty(name);
    }
    for (const [name, value] of Object.entries(vars)) {
      if (lastVars[name] !== value) root.style.setProperty(name, value);
    }
    lastVars = vars;
    root.style.colorScheme = theme.base;
    root.dataset.theme = theme.id;
    root.dataset.themeBase = theme.base;
    root.classList.toggle('has-bg-image', vars['--bg-image'] !== 'none');

    for (const f of appearance.customFonts) loadFont(f);
    if (appearance.background.assetId !== bg.assetId) loadBackground(appearance.background.assetId);
  }

  return { apply, loadFont };
}

// --- Commands: theme.<id> per theme, theme.next ----------------------------

function createThemeCommands(store) {
  let unregister = [];
  let lastKey = '';
  function sync(appearance) {
    const themes = allThemes({ appearance });
    const key = themes.map((t) => `${t.id}:${t.name}`).join('|');
    if (key === lastKey) return;
    lastKey = key;
    for (const off of unregister) off();
    unregister = [];
    const add = (cmd) => {
      try {
        const off = registerCommand(cmd);
        if (typeof off === 'function') unregister.push(off);
      } catch (err) {
        console.warn('[theme] registering a command failed:', err);
      }
    };
    for (const t of themes) {
      add({
        id: `theme.${t.id}`,
        title: `Theme: ${t.name}`,
        group: 'Theme',
        run: () => store.update((a) => ({ ...a, themeId: t.id })),
      });
    }
    add({
      id: 'theme.next',
      title: 'Next theme',
      group: 'Theme',
      run: () => store.update((a) => {
        const list = allThemes({ appearance: a });
        const i = list.findIndex((t) => t.id === a.themeId);
        return { ...a, themeId: list[(i + 1) % list.length].id };
      }),
    });
  }
  return { sync };
}

// --- Exports (SPEC 9.5.6) --------------------------------------------------

let shared = null;

function ensure(proxy) {
  if (!shared) {
    const store = createStore(proxy);
    const engine = createEngine(proxy, store);
    const commands = createThemeCommands(store);
    store.subscribe((a) => {
      engine.apply(a);
      commands.sync(a);
    });
    shared = { store, engine, commands };
  }
  return shared;
}

/**
 * Apply settings.appearance now and on every change.
 * @param {{ proxy: any, settings: object, onSettings: (cb: (s: object) => void) => () => void }} ctx
 */
export function mountTheme({ proxy, settings, onSettings }) {
  const { store, engine, commands } = ensure(proxy);
  store.receive(settings);
  const a = store.get();
  engine.apply(a);
  commands.sync(a);
  if (typeof onSettings === 'function') onSettings((next) => store.receive(next));
}

/**
 * Fill the Look tab of Settings.
 * @param {HTMLElement} container
 * @param {{ proxy: any, settings: object, onSettings: Function, save: (patch: object) => Promise<object> }} ctx
 */
export function mountLookSettings(container, { proxy, settings, save }) {
  if (!container) return;
  const { store, engine } = ensure(proxy);
  store.setSaver(save);
  if (settings && !store.settings().appearance) store.receive(settings);
  mountLook(container, { proxy, store, loadFont: engine.loadFont });
}

/** Built-in themes followed by the user's, for the command bar. @returns {{ id: string, name: string }[]} */
export function listThemes(settings) {
  return allThemes(settings).map(({ id, name }) => ({ id, name }));
}
