'use strict';

/* Snip overlay page. Draws the selection box and reports it to main. */

(async () => {
  const shot = document.getElementById('shot');
  const sel = document.getElementById('sel');
  const size = document.getElementById('size');
  let start = null;
  let finished = false;

  function rectFrom(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function draw(r) {
    sel.hidden = false;
    sel.style.left = `${r.x}px`;
    sel.style.top = `${r.y}px`;
    sel.style.width = `${r.width}px`;
    sel.style.height = `${r.height}px`;
    size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    size.style.top = r.y < 24 ? '4px' : '-22px';
  }

  function cancel() {
    if (finished) return;
    finished = true;
    window.overlay.cancel();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
  });

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || finished) return;
    start = { x: e.clientX, y: e.clientY };
    document.body.classList.add('selecting');
    draw(rectFrom(start, start));
  });
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    draw(rectFrom(start, { x: e.clientX, y: e.clientY }));
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !start || finished) return;
    const r = rectFrom(start, { x: e.clientX, y: e.clientY });
    start = null;
    if (r.width < 4 || r.height < 4) {
      // Stray click: reset and let the user try again.
      sel.hidden = true;
      document.body.classList.remove('selecting');
      return;
    }
    finished = true;
    // The screenshot is stretched to fill the window, so send the viewport size
    // too; main maps the rect onto the display even if the WM resized us.
    window.overlay.select({ ...r, viewWidth: window.innerWidth, viewHeight: window.innerHeight });
  });

  try {
    const { imageUrl } = await window.overlay.getImage();
    shot.src = imageUrl;
    await shot.decode();
  } catch {
    /* show anyway; main still crops from its own copy */
  }
  window.overlay.ready();
})();
