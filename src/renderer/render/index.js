// OWNER: Worker 2 (UI phase). Rich reply rendering: Markdown, math, code, plots (SPEC 9.7).
// Step 0 stub from the lead: plain text with line breaks. Keep the exported shape.

/**
 * @param {string} markdown
 * @param {{ kind: 'answer'|'explanation' }} [opts]
 * @returns {HTMLElement}  a sanitized element with class "rich"
 */
export function renderRich(markdown, _opts = {}) {
  const root = document.createElement('div');
  root.className = 'rich';
  root.textContent = String(markdown || '');
  return root;
}
