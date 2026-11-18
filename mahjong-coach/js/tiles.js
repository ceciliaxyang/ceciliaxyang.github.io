// Tile names and the SVG faces drawn on each tile (traditional Chinese tile art, simplified).
import { suitOf, numOf } from "./engine.js";
import { zh } from "./lang.js";

const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const WINDS = ["東", "南", "西", "北"];
const WIND_EN = ["East", "South", "West", "North"];
const DRAGON_EN = ["Red", "Green", "White"];
const BONUS = ["梅", "蘭", "菊", "竹", "春", "夏", "秋", "冬"];
const BONUS_EN = ["Plum", "Orchid", "Chrysanthemum", "Bamboo", "Spring", "Summer", "Autumn", "Winter"];
const SUIT_EN = ["Character", "Circles", "Bamboo"];  // "4 Character", "4 Circles", "4 Bamboo"

const RED = "#c8141c";   // Porcelain white palette: classic Hong Kong inks on white
const GREEN = "#00803d";
const BLUE = "#0b3fa8";
const INK = "#111111";
const FACE = "#ffffff";
// Kaiti (brush style): Apple's Kaiti TC/SC first, then the Kai fonts Windows and Android ship, then any serif.
// Tile characters, in order of preference: LXGW WenKai TC (a Kai-style web font, so it's the same in every
// browser), Klee One (a web font too, if WenKai can't load), then Kaiti on Macs that have it, then other Kai
// fonts. Both web fonts are loaded in index.html. (Safari can't use Kaiti: it's an optional macOS download.)
const SERIF = `'LXGW WenKai TC','Klee One','Kaiti TC','Kaiti SC','STKaiti','BiauKai','DFKai-SB','KaiTi','TW-Kai','AR PL UKai TW',serif`;

export function tileName(k) {
  if (k < 27) return `${numOf(k)} ${SUIT_EN[suitOf(k)]}`;
  if (k < 31) return `${WIND_EN[k - 27]} wind`;
  if (k < 34) return `${DRAGON_EN[k - 31]} dragon`;
  return `${BONUS_EN[k - 34]} (${k < 38 ? "flower" : "season"} ${((k - 34) % 4) + 1})`;
}

/* Short label like "5 Circles" → used inside sentences. */
export const shortName = tileName;

function dot(x, y, r, color) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${x}" cy="${y}" r="${r * 0.66}" fill="${FACE}"/><circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="${color}"/><circle cx="${x}" cy="${y}" r="${r * 0.14}" fill="${FACE}"/>`;
}

const DOTS = {
  1: () => `<circle cx="30" cy="40" r="19" fill="none" stroke="${GREEN}" stroke-width="2.5"/>` + dot(30, 40, 15, RED),
  2: () => dot(30, 22, 11, GREEN) + dot(30, 58, 11, BLUE),
  3: () => dot(15, 17, 9, BLUE) + dot(30, 40, 9, RED) + dot(45, 63, 9, GREEN),
  4: () => dot(18, 22, 10, BLUE) + dot(42, 22, 10, GREEN) + dot(18, 58, 10, GREEN) + dot(42, 58, 10, BLUE),
  5: () => dot(16, 18, 9, BLUE) + dot(44, 18, 9, GREEN) + dot(30, 40, 9, RED) + dot(16, 62, 9, GREEN) + dot(44, 62, 9, BLUE),
  6: () => [[18, 15], [42, 15]].map(([x, y]) => dot(x, y, 8.5, GREEN)).join("") +
    [[18, 44], [42, 44], [18, 66], [42, 66]].map(([x, y]) => dot(x, y, 8.5, RED)).join(""),
  7: () => [[13, 12], [30, 20], [47, 28]].map(([x, y]) => dot(x, y, 7, GREEN)).join("") +
    [[18, 48], [42, 48], [18, 68], [42, 68]].map(([x, y]) => dot(x, y, 8, RED)).join(""),
  8: () => [13, 31, 49, 67].flatMap((y) => [dot(18, y, 8, BLUE), dot(42, y, 8, BLUE)]).join(""),
  9: () => [[16, BLUE], [40, RED], [64, GREEN]].flatMap(([y, col]) => [14, 30, 46].map((x) => dot(x, y, 7.5, col))).join(""),
};

function stick(x, y, h, color) {
  const w = 7;
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3.5" fill="${color}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${y - 1.2}" width="${w + 2}" height="2.4" rx="1.2" fill="${color}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${y - h / 2}" width="${w + 2}" height="2.4" rx="1.2" fill="${color}"/>` +
    `<rect x="${x - w / 2 - 1}" y="${y + h / 2 - 2.4}" width="${w + 2}" height="2.4" rx="1.2" fill="${color}"/>` +
    `<line x1="${x}" y1="${y - h / 2 + 3}" x2="${x}" y2="${y + h / 2 - 3}" stroke="${FACE}" stroke-width="1" opacity=".55"/>`;
}

const BAMBOO = {
  1: () => // the traditional "bird" one-bamboo, stylised
    `<path d="M22 60 C 8 66, 10 76, 20 72 C 14 78, 26 80, 28 70" fill="${GREEN}"/>` +
    `<ellipse cx="31" cy="48" rx="12" ry="16" fill="${GREEN}"/>` +
    `<path d="M24 44 C 30 38, 40 42, 40 52 C 36 48, 30 48, 24 44 Z" fill="${BLUE}"/>` +
    `<circle cx="34" cy="25" r="8" fill="${RED}"/><circle cx="36" cy="23" r="1.8" fill="${FACE}"/>` +
    `<path d="M41 25 L 49 22 L 42 29 Z" fill="${INK}"/>` +
    `<path d="M27 64 L 25 72 M 35 64 L 37 72" stroke="${RED}" stroke-width="2" stroke-linecap="round"/>`,
  2: () => stick(30, 22, 26, GREEN) + stick(30, 58, 26, BLUE),
  3: () => stick(30, 22, 26, BLUE) + stick(18, 58, 26, GREEN) + stick(42, 58, 26, GREEN),
  4: () => stick(19, 22, 26, BLUE) + stick(41, 22, 26, GREEN) + stick(19, 58, 26, GREEN) + stick(41, 58, 26, BLUE),
  5: () => stick(14, 22, 26, GREEN) + stick(46, 22, 26, BLUE) + stick(30, 40, 26, RED) + stick(14, 58, 26, BLUE) + stick(46, 58, 26, GREEN),
  6: () => [14, 30, 46].map((x) => stick(x, 22, 26, GREEN)).join("") + [14, 30, 46].map((x) => stick(x, 58, 26, BLUE)).join(""),
  7: () => stick(30, 14, 20, RED) + [14, 30, 46].map((x) => stick(x, 40, 20, GREEN)).join("") + [14, 30, 46].map((x) => stick(x, 65, 20, GREEN)).join(""),
  8: () => [12, 24, 36, 48].map((x) => stick(x, 22, 26, GREEN)).join("") + [12, 24, 36, 48].map((x) => stick(x, 58, 26, BLUE)).join(""),
  9: () => [14, 40, 66].flatMap((y) => [stick(14, y, 20, GREEN), stick(30, y, 20, RED), stick(46, y, 20, BLUE)]).join(""),
};

function text(ch, y, size, color, weight = 700) {
  return `<text x="30" y="${y}" text-anchor="middle" font-family="${SERIF}" font-size="${size}" font-weight="${weight}" fill="${color}">${zh(ch)}</text>`;
}

/* Flower and season tiles, after a real bonus tile: the number top left, a small character top right, and a
   painted flower filling the face (a curling stem with leaves, a big blossom in the tile's colour, leaves below). */
function leaf(x1, y1, x2, y2, w, col) {
  // a pointed leaf from (x1,y1) to (x2,y2), w wide at its middle
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w, ny = (dx / len) * w;
  const f = (v) => v.toFixed(1);
  return `<path d="M${f(x1)} ${f(y1)} Q${f(mx + nx)} ${f(my + ny)} ${f(x2)} ${f(y2)} Q${f(mx - nx)} ${f(my - ny)} ${f(x1)} ${f(y1)}Z" fill="${col}"/>`;
}
function flowerArt(col) {
  const petal = col === GREEN ? RED : col;  // green tiles keep a red blossom so it stands out from the leaves
  const cx = 30, cy = 55;
  const petals = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `<circle cx="${(cx + Math.cos(a) * 5.4).toFixed(1)}" cy="${(cy + Math.sin(a) * 5.4).toFixed(1)}" r="4.6" fill="${petal}"/>`;
  }).join("");
  return (
    // curling stem with small leaves along it
    `<path d="M24 22 C 32 22, 38 30, 34 39 C 32 43, 30 45, 30 49" fill="none" stroke="${GREEN}" stroke-width="1.8" stroke-linecap="round"/>` +
    leaf(35, 30, 41, 27, 1.8, GREEN) + leaf(35, 36, 41, 37, 1.8, GREEN) + leaf(32, 42, 27, 39, 1.6, GREEN) +
    // side leaves under the blossom
    leaf(29, 50, 14, 47, 3, GREEN) + leaf(31, 50, 46, 46, 3, GREEN) +
    // the blossom: six petals, a pale ring and a dot at its heart
    petals + `<circle cx="${cx}" cy="${cy}" r="4.4" fill="${FACE}"/><circle cx="${cx}" cy="${cy}" r="2.2" fill="${petal}"/>` +
    // leaves along the bottom
    leaf(30, 70, 12, 66, 3, GREEN) + leaf(30, 70, 48, 65, 3, GREEN) + leaf(30, 70, 24, 62, 2.2, GREEN) + leaf(30, 70, 37, 62, 2.2, GREEN)
  );
}

/* Every Chinese character on a tile (numerals, winds, dragons) uses the same Kaiti size and baseline. Flowers and
   seasons are the exception: a small character in the corner, with the painted flower filling the tile. */
const CHAR_SIZE = 42;
const CHAR_Y = 56;

export function faceSvg(k) {
  let body;
  if (k < 9) body = text(NUMERALS[k], CHAR_Y, CHAR_SIZE, INK);  // Characters: just the numeral (no 萬), with a corner number
  else if (k < 18) body = DOTS[numOf(k)]();
  else if (k < 27) body = BAMBOO[numOf(k)]();
  else if (k < 31) body = text(WINDS[k - 27], CHAR_Y, CHAR_SIZE, INK);
  else if (k === 31) body = text("中", CHAR_Y, CHAR_SIZE, RED);
  else if (k === 32) body = text("發", CHAR_Y, CHAR_SIZE, GREEN);
  else if (k === 33)
    body = `<rect x="12" y="13" width="36" height="54" rx="4" fill="none" stroke="${BLUE}" stroke-width="3.5"/><rect x="18" y="19" width="24" height="42" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.2"/>`;
  else {
    const i = k - 34;
    const col = [RED, BLUE, "#c77a12", GREEN, GREEN, RED, "#c77a12", BLUE][i];
    body = `<text x="7" y="20" font-family="'SF Pro Display',-apple-system,system-ui,sans-serif" font-size="15" font-weight="700" fill="${INK}">${(i % 4) + 1}</text>` +
      `<text x="45" y="21" text-anchor="middle" font-family="${SERIF}" font-size="15" font-weight="700" fill="${col}">${zh(BONUS[i])}</text>` +
      flowerArt(col);
  }
  // Small corner number (upper right) on circles and bamboo, haloed in the tile's ivory so it reads over the pattern; the pattern shifts down a little to make room.
  if (k < 9)
    body += `<text x="56" y="14" text-anchor="end" font-family="'SF Pro Display',-apple-system,system-ui,sans-serif" font-size="12" font-weight="700" fill="${INK}">${numOf(k)}</text>`;
  else if (k < 27)
    body = `<g transform="translate(4.8 10) scale(.84)">${body}</g>` + `<text x="56" y="14" text-anchor="end" font-family="'SF Pro Display',-apple-system,system-ui,sans-serif" font-size="12" font-weight="700" fill="${INK}" stroke="${FACE}" stroke-width="3" paint-order="stroke">${numOf(k)}</text>`;
  return `<svg viewBox="0 0 60 80" aria-hidden="true">${body}</svg>`;
}

/* A tile as an HTML string. size: "lg" (your hand), "md", "sm", "xs". */
export function tileHtml(k, { size = "md", id = null, cls = "", button = false, title = true } = {}) {
  const tag = button ? "button" : "span";
  const attrs = [
    `class="tile ${size} ${cls}"`,
    id !== null ? `data-id="${id}"` : "",
    title ? `title="${tileName(k)}" aria-label="${tileName(k)}"` : "",
    button ? `type="button"` : `role="img"`,
  ].join(" ");
  return `<${tag} ${attrs}>${faceSvg(k)}</${tag}>`;
}

export function backHtml(size = "sm", cls = "") {
  return `<span class="tile back ${size} ${cls}" aria-hidden="true"></span>`;
}

export { WIND_EN, WINDS };
