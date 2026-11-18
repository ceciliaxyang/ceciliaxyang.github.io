// Swipe down to close a bottom sheet, as on iOS (phones only). The sheet follows your finger; let go past a
// third of its height, or with a quick flick, and it slides away and closes. Otherwise it springs back.
// A drag only starts the sheet moving when its content is scrolled to the top, so scrolling still works.

const PHONE = matchMedia("(max-width: 600px)");

/* sheet: the element that moves. scroller: what scrolls inside it (may be the sheet itself).
   close(animated): called once the sheet should close; slideOut says whether this module animates it away
   first (true for sheets that vanish at once when closed, false for ones whose own CSS slides them out). */
export function swipeToClose(sheet, scroller, close, { slideOut = false } = {}) {
  let y0 = null, x0 = 0, t0 = 0, dy = 0, dragging = false;

  const reset = () => { sheet.style.transform = ""; sheet.style.transition = ""; };

  sheet.addEventListener("touchstart", (e) => {
    if (!PHONE.matches || e.touches.length > 1) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = performance.now(); dy = 0; dragging = false;
  }, { passive: true });

  sheet.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    const d = e.touches[0].clientY - y0;
    if (!dragging) {
      // only a downward drag that starts with the content at its top, and more down than sideways
      if (d < 6 || scroller.scrollTop > 0 || Math.abs(e.touches[0].clientX - x0) > d) { if (Math.abs(d) > 6) y0 = null; return; }
      dragging = true;
      sheet.style.transition = "none";
    }
    e.preventDefault();  // the sheet moves instead of the page or its content
    dy = Math.max(0, d - 6);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });

  const end = () => {
    if (y0 === null) return;
    y0 = null;
    if (!dragging) return;
    dragging = false;
    const speed = dy / Math.max(1, performance.now() - t0);  // px per ms
    if (dy > sheet.offsetHeight / 3 || (speed > 0.5 && dy > 40)) {
      if (slideOut) {
        sheet.style.transition = "transform .25s cubic-bezier(.2, .7, .3, 1)";
        sheet.style.transform = "translateY(100%)";
        setTimeout(() => { close(); reset(); }, 250);
      } else {
        reset();   // its closed state slides it the rest of the way down from here
        close();
      }
    } else {
      sheet.style.transition = "transform .3s cubic-bezier(.2, .9, .3, 1.15)";  // spring back up
      sheet.style.transform = "";
      setTimeout(() => { if (y0 === null) sheet.style.transition = ""; }, 300);
    }
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}
