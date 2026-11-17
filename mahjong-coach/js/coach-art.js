// The coach: Guanyin (v2), after traditional gongbi paintings. A white hood over black hair, a small gold crown,
// a full face with downcast eyes, and fine blue-grey lines that taper like real brush strokes (drawn thick
// enough to read at button size). A gold halo glows behind her only when the coach has something to say.
// The first portrait is kept in coach-art-guanyin-v1.js.

const LINE = "#6f86a1";   // hood and fold lines
const INK = "#141414";    // hair, brows, eyes
const RED = "#c8141c";    // tile red: lips, the dot on her brow, crown jewel, beads
const GOLD = "#c9962b";   // crown and necklace
const SKIN = "#f6e2d0";   // warmer than the hood so her face stands out from it
const SHADE = "#a88c78";  // the fine line around her face, her nose

/* A brush stroke along a cubic curve: it lands thin, swells, then lifts off to a point. */
function cub(p, t) {
  const u = 1 - t;
  return [
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
  ];
}
function brush(p, w, a = 0.2, b = 0.4) {
  const n = 30, L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = cub(p, t), [x2, y2] = cub(p, Math.min(1, t + 0.01)), [x0, y0] = cub(p, Math.max(0, t - 0.01));
    let dx = x2 - x0, dy = y2 - y0;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    let f = t < a ? t / a : t > 1 - b ? (1 - t) / b : 1;
    f = Math.pow(Math.max(0, f), 0.6) * (0.82 + 0.18 * Math.sin(Math.PI * t));
    const h = (w * f) / 2;
    L.push([x - dy * h, y + dx * h]);
    R.push([x + dy * h, y - dx * h]);
  }
  return "M" + [...L, ...R.reverse()].map((q) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join(" L") + "Z";
}
const THICK = 1.8;  // lines thickened so they survive at 48px
const st = (p, w, c = LINE, a, b) => `<path d="${brush(p, w * THICK, a, b)}" fill="${c}"/>`;

// The face is widened about its centre line (the paintings show a full, rounded face), the hood a little more.
const FW = 1.12, HW = 1.13;
const X = (x) => 40 + (x - 40) * FW;
const HX = (x) => 40 + (x - 40) * HW;
const P = (pts) => pts.map(([x, y]) => [X(x), y]);
const wide = (d) => d.replace(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g, (m, x, y) => `${X(+x).toFixed(2)} ${y}`);

/* Everything but the halo, in an 80x80 box (the robe runs off the bottom). Built once. */
const FIGURE = (() => {
  let f = "";
  f += `<path d="M2 86 C6 72 16 64 30 61 L50 61 C64 64 74 72 78 86Z" fill="#fff"/>`;
  f += `<path d="M40 9 C${HX(29)} 9 ${HX(23.8)} 17.8 ${HX(23)} 28.5 C${HX(22.2)} 39 ${HX(20)} 51 ${HX(12.5)} 61.5 C${HX(19.5)} 64.5 ${HX(25.5)} 71 ${HX(28.5)} 86 L${HX(51.5)} 86 C${HX(54.5)} 71 ${HX(60.5)} 64.5 ${HX(67.5)} 61.5 C${HX(60)} 51 ${HX(57.8)} 39 ${HX(57)} 28.5 C${HX(56.2)} 17.8 ${HX(51)} 9 40 9Z" fill="#fff"/>`;
  f += `<ellipse cx="40" cy="38" rx="15" ry="17" fill="url(#gyShade)"/>`;   // soft shadow inside the hood
  // hair, parted in the middle, falling either side of her face
  f += `<path d="${wide("M30.4 33.5 C29.8 24.8 34.4 20 40 20 C45.6 20 50.2 24.8 49.6 33.5 C48.4 28.4 45.6 25.8 40.2 26.1 C40 25.3 39.8 25.3 39.6 26.1 C34.4 25.9 31.6 28.4 30.4 33.5Z")}" fill="${INK}"/>`;
  f += `<path d="${wide("M30.5 31 C29.8 37 30.4 43.5 32.4 47.5 C31.3 42 31.3 37 32.1 31.8Z")}" fill="${INK}"/><path d="${wide("M49.5 31 C50.2 37 49.6 43.5 47.6 47.5 C48.7 42 48.7 37 47.9 31.8Z")}" fill="${INK}"/>`;
  // neck and a full face with a soft chin, outlined in a fine painted line
  f += `<path d="${wide("M36.4 48 L36.2 56 L44 56 L43.6 48Z")}" fill="${SKIN}"/>`;
  f += `<path d="${wide("M32 31.8 C31.2 38.5 32 44.5 34.8 48 C36.5 49.9 38.3 50.5 40 50.6 C41.8 50.5 43.6 49.9 45.3 48 C48.1 44.5 48.9 38.5 48.2 31.8 C46.4 29 43.4 27.9 40.1 28.2 C36.7 27.9 33.8 29 32 31.8Z")}" fill="${SKIN}"/>`;
  [[[32.1, 33], [31.5, 40], [32.4, 45.5], [35, 48.3]], [[48.1, 33], [48.7, 40], [47.8, 45.5], [45.2, 48.3]], [[35, 48.3], [37, 50.2], [43, 50.2], [45.2, 48.3]]]
    .forEach((c, i) => { f += st(P(c), i === 2 ? 0.36 : 0.42, SHADE, 0.15, 0.15); });
  f += `<ellipse cx="${X(35.2)}" cy="42.6" rx="2.5" ry="1.4" fill="#f0a89c" opacity=".45"/><ellipse cx="${X(44.9)}" cy="42.4" rx="2.4" ry="1.3" fill="#f0a89c" opacity=".4"/>`;
  // crown on the hood
  f += `<path d="M40 11.6 C42.6 14.2 43.9 17.2 43 20.4 L37 20.4 C36.1 17.2 37.4 14.2 40 11.6Z" fill="${GOLD}"/><path d="M40 13.9 C41.2 15.3 41.5 16.7 41.1 18.2 L38.9 18.2 C38.5 16.7 38.8 15.3 40 13.9Z" fill="#2f6fb0"/><circle cx="40" cy="19.3" r="1.1" fill="${RED}"/>`;
  // brows, downcast eyes (not quite mirror images), nose, lips, the dot on her brow
  f += st(P([[33.6, 34.1], [35, 33.1], [37, 33.0], [38.7, 33.7]]), 0.42, INK, 0.25, 0.6) + st(P([[41.4, 33.6], [43, 32.9], [45.1, 33.1], [46.5, 34.2]]), 0.4, INK, 0.25, 0.55);
  f += st(P([[34.2, 36.6], [35.5, 37.6], [37.3, 37.7], [38.7, 36.9]]), 0.7, INK, 0.18, 0.45) + st(P([[41.4, 36.8], [42.8, 37.6], [44.6, 37.5], [45.9, 36.6]]), 0.68, INK, 0.18, 0.5);
  f += st([[40.4, 37.6], [40.6, 40], [40.9, 42], [40.3, 42.8]], 0.34, SHADE, 0.3, 0.4);
  f += `<path d="${wide("M37.6 45.9 C38.9 45.2 39.7 45.4 40.1 45.8 C40.5 45.4 41.4 45.2 42.7 45.9 C41.8 47.6 38.6 47.7 37.6 45.9Z")}" fill="${RED}" opacity=".9"/><circle cx="40.1" cy="31.2" r="1" fill="${RED}"/>`;
  // the hood's edges and folds
  f += st([[40, 9.3], [HX(29.5), 9.6], [HX(24.4), 18], [HX(23.6), 28.5]], 0.8, LINE, 0.05, 0.3) + st([[HX(23.6), 29], [HX(22.4), 40], [HX(19.6), 51.5], [HX(12.9), 61.3]], 0.75, LINE, 0.15, 0.45);
  f += st([[40, 9.3], [HX(50.5), 9.6], [HX(55.6), 18], [HX(56.4), 28.5]], 0.7, LINE, 0.05, 0.35) + st([[HX(56.4), 29], [HX(57.6), 40], [HX(60.4), 51.5], [HX(67.1), 61.3]], 0.68, LINE, 0.15, 0.5);
  f += st(P([[32.4, 24.5], [31.2, 34], [32.2, 47], [35.4, 54]]), 0.7, LINE, 0.3, 0.4) + st(P([[47.8, 24.5], [49, 34], [48, 47], [44.8, 54.4]]), 0.63, LINE, 0.3, 0.45);
  // necklace with three red beads
  f += st(P([[35.4, 57], [37.6, 60.4], [42.6, 60.4], [44.8, 57]]), 0.5, GOLD, 0.15, 0.15);
  P([[37.6, 60.2], [40.1, 61], [42.6, 60.2]]).forEach(([x, y]) => { f += `<circle cx="${x}" cy="${y + 1.1}" r=".95" fill="${RED}"/>`; });
  return f;
})();

// gradients are referenced by id, so each drawing on the page gets its own
let uid = 0;
function guanyinSvg(cls, viewBox, haloR = 33, haloY = 30, haloK = 1) {
  const id = ++uid;
  // haloK sets how strong the gold is (1 = full)
  const defs = `<defs>
    <radialGradient id="gyHalo${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff3c4" stop-opacity="${haloK}"/><stop offset=".45" stop-color="#ffd76a" stop-opacity="${haloK}"/><stop offset=".75" stop-color="#f3ae2a" stop-opacity="${0.85 * haloK}"/><stop offset="1" stop-color="#e8961a" stop-opacity="0"/></radialGradient>
    <radialGradient id="gyShade${id}" cx="50%" cy="46%" r="50%"><stop offset=".55" stop-color="#c9d3df" stop-opacity=".6"/><stop offset="1" stop-color="#c9d3df" stop-opacity="0"/></radialGradient></defs>`;
  return `<svg class="${cls}" viewBox="${viewBox}" aria-hidden="true">${defs}<circle class="gy-halo" cx="40" cy="${haloY}" r="${haloR}" fill="url(#gyHalo${id})"/>${FIGURE.replace("url(#gyShade)", `url(#gyShade${id})`)}</svg>`;
}

/* The Coach button: a small porcelain tile, floating, with Guanyin painted on its face as a bust. Its parts:
   a gold glow behind it (shown with an insight or on hover), a soft shadow on the table below, then the tile
   itself (two edge layers for its thickness, and the face). Sizes and motion are in the CSS (.coach-tile). */
export function coachTileHtml() {
  // the "Coach" label sits on the tile's face, over the bottom of her robe (it's also the button's name)
  return `<span class="coach-tile">
    <span class="ct-glow"></span><span class="ct-shadow"></span>
    <span class="ct-body"><span class="ct-rim"></span><span class="ct-edge"></span><span class="ct-face">${guanyinSvg("gy", "12 6 56 68", 0)}</span><span class="ct-label">Coach</span></span>
  </span>`;
}

/* The earlier pill figure (no longer used by the button). */
export function coachAvatarHtml() {
  // "barely there": a small, faint warmth behind her. The view box starts higher (y 0, not 6) so she sits
  // lower in the pill and the glow stops short of its top edge.
  return `<span class="coach-av">${guanyinSvg("gy", "10 0 60 60", 33, 32, 0.45)}</span>`;
}

/* The bare drawing, for the link preview (og/og.html draws it onto a tile). */
export function guanyinMarkup(viewBox = "0 0 80 80") {
  return guanyinSvg("gy", viewBox);
}

/* The portrait in the coach panel's header: her glow, no background. */
export function coachPortraitHtml() {
  // the same faint glow as the Coach me button, always on here
  return `<div class="coach-portrait" aria-hidden="true">${guanyinSvg("gy", "10 0 60 60", 33, 32, 0.45)}</div>`;
}
