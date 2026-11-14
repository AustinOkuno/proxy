'use strict';

/**
 * Panel visibility rules (pure, no Electron). Values are PANEL_VISIBILITY.
 */

const { PANEL_VISIBILITY } = require('../../shared/contracts');

/** Should the panel be shown when the app starts? */
function showAtStart(mode) {
  return mode !== PANEL_VISIBILITY.HIDDEN_UNTIL_CAPTURE;
}

/**
 * What the togglePanel hotkey does.
 *  - toggle / hidden-until-capture: show if hidden (or not focused), hide if visible.
 *  - always: never hides; brings the panel to the front.
 * @returns {'show'|'hide'}
 */
function toggleAction(mode, visible) {
  if (mode === PANEL_VISIBILITY.ALWAYS) return 'show';
  return visible ? 'hide' : 'show';
}

/**
 * What to do when the setting changes while running.
 * Switching to `always` shows the panel; other modes leave it as it is
 * (the user is probably looking at Settings in the panel right now).
 * @returns {'show'|null}
 */
function onModeChange(prev, next) {
  if (prev === next) return null;
  return next === PANEL_VISIBILITY.ALWAYS ? 'show' : null;
}

module.exports = { showAtStart, toggleAction, onModeChange };
