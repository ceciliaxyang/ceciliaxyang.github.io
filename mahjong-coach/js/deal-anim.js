// New-game transition: the buttons and labels fade away, every tile slides into a "mid-shuffle swirl" in the
// middle (scattered at every angle, but never overlapping, like real tiles), the pile flips face down, then in one
// move every tile goes to its player or onto the wall, and your own tiles turn face up. The real table is hidden
// underneath until the last tile lands. Skipped entirely for people who prefer reduced motion.

const GHOST_W = 40;  // every flying tile is drawn at this width and scaled to fit where it is or goes
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const TABLE_TILES = "#table .tile, #sheet .tile";

function visibleTiles() {
  return [...document.querySelectorAll(TABLE_TILES)].filter((t) => {
    const r = t.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
  });
}

/* Where a tile sits: its centre, its upright width, and whether it lies sideways (the side players'). */
function place(t) {
  const r = t.getBoundingClientRect();
  const sideways = r.width > r.height * 1.05;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: sideways ? r.height : r.width, rot: sideways ? 90 : 0 };
}

const transform = (g) => `translate(${g.x - GHOST_W / 2}px, ${g.y - GHOST_W * 0.75}px) rotate(${g.rot}deg) scale(${g.s})`;

function move(g, to, duration, delay = 0, easing = "cubic-bezier(.3, .7, .2, 1)") {
  const from = transform(g);
  Object.assign(g, to);
  const anim = g.el.animate([{ transform: from }, { transform: transform(g) }], { duration, delay, easing, fill: "forwards" });
  return anim.finished;
}

/* Turn a tile over like a real one: it lifts a little, tips over on its long edge in 3D, shows its thick
   two-layer side (white face, green back) halfway round, then drops onto its other face with a small bounce. */
async function flip(g, html, back, delay = 0) {
  await wait(delay);
  const t = transform(g);
  const up = `${t} translateY(-7px)`;  // lifted off the table (in the tile's own units)
  const P = "perspective(220px)";
  // 1. lift and tip up until we're nearly looking at its edge
  await g.el.animate([
    { transform: `${t} ${P} rotateY(0deg)` },
    { transform: `${up} ${P} rotateY(78deg)` },
  ], { duration: 170, easing: "cubic-bezier(.4, 0, .9, .6)", fill: "forwards" }).finished;
  // 2. edge-on: the tile's thickness, the white face layer on one side and the green back on the other
  const faceFirst = back;  // face-up turning face-down shows white, then green
  g.el.className = `tile flip-side${faceFirst ? "" : " rev"}`;
  g.el.innerHTML = "";
  await g.el.animate([
    { transform: `${up} scaleX(.48)` },
    { transform: `${up} scaleX(.56)` },
  ], { duration: 60, easing: "linear", fill: "forwards" }).finished;
  // 3. over the top and down onto the other face, settling with a little bounce
  g.el.className = back ? "tile back" : "tile";
  g.el.innerHTML = back ? "" : html;
  await g.el.animate([
    { transform: `${up} ${P} rotateY(-78deg)`, easing: "cubic-bezier(.2, .6, .4, 1)" },
    { transform: `${t} translateY(1.5px) ${P} rotateY(0deg)`, offset: .72, easing: "ease-out" },
    { transform: `${t} translateY(-1px) ${P} rotateY(0deg)`, offset: .88 },
    { transform: `${t} ${P} rotateY(0deg)` },
  ], { duration: 260, fill: "forwards" }).finished;
}

function makeGhost(layer, p, html, back) {
  const el = document.createElement("span");
  el.className = back ? "tile back" : "tile";
  el.innerHTML = back ? "" : html;
  layer.appendChild(el);
  const g = { el, x: p.x, y: p.y, rot: p.rot, s: p.w / GHOST_W };
  el.style.transform = transform(g);
  return g;
}

/* Scatter n tiles (w wide, 1.5w tall) at any angle across an rx × ry oval with none touching. */
function swirl(n, w, rx, ry) {
  const h = w * 1.5, margin = w * 0.08;
  const corners = (t) => {
    const c = Math.cos(t.rot * Math.PI / 180), s = Math.sin(t.rot * Math.PI / 180);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [t.x + x * c - y * s, t.y + x * s + y * c]);
  };
  const apart = (A, B) => {  // separating-axis test on the two rotated rectangles
    for (const P of [A, B]) for (let i = 0; i < 2; i++) {
      const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy), ax = -dy / l, ay = dx / l;
      const a = A.map((p) => p[0] * ax + p[1] * ay), b = B.map((p) => p[0] * ax + p[1] * ay);
      if (Math.max(...a) + margin < Math.min(...b) || Math.max(...b) + margin < Math.min(...a)) return true;
    }
    return false;
  };
  const placed = [], polys = [];
  let grow = 1;
  while (placed.length < n) {
    let ok = false;
    for (let tries = 0; tries < 400 && !ok; tries++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random());
      const t = { x: Math.cos(a) * d * rx * grow, y: Math.sin(a) * d * ry * grow, rot: Math.random() * 360 - 180 };
      const P = corners(t);
      if (polys.every((Q) => apart(P, Q))) { placed.push(t); polys.push(P); ok = true; }
    }
    if (!ok) grow *= 1.05;  // crowded: let the pile spread a little
  }
  return placed;
}

/* The new table's tiles, grouped by player (each player's hand and flowers), then anything else
   (the wall). All of them are dealt in the same single move. */
function dealOrder() {
  const byPlayer = [0, 1, 2, 3].map((p) => {
    const sel = p === 0 ? "#meExposed .tile, #hand .tile" : `.seat[data-p="${p}"] .tile`;
    return [...document.querySelectorAll(sel)];
  });
  const order = [];
  const taken = new Set();
  for (let round = 0; round < 4; round++) {
    const n = round < 3 ? 4 : 2;
    for (const tiles of byPlayer) tiles.splice(0, n).forEach((t) => { order.push(t); taken.add(t); });
  }
  for (const tiles of byPlayer) tiles.forEach((t) => { order.push(t); taken.add(t); });
  visibleTiles().forEach((t) => { if (!taken.has(t)) order.push(t); });
  return order;
}

/* Play the whole transition. `startNew` swaps in the new game and renders it (hidden underneath). */
export async function dealAnimation(startNew) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { startNew(); return; }
  const body = document.body;
  const layer = document.createElement("div");
  layer.className = "deal-layer";
  body.appendChild(layer);

  // 1. buttons and labels fade away; the real tiles hand over to stand-ins
  body.classList.add("dealing");
  let ghosts = visibleTiles().map((t) => {
    const back = t.classList.contains("back") || t.classList.contains("face-down");
    return { g: makeGhost(layer, place(t), t.innerHTML, back), back };
  });
  body.classList.add("dealing-hide");
  await wait(280);

  // 2. every tile slides into the middle in a "mid-shuffle swirl": scattered at every angle across an
  //    oval, like hands mixing the tiles, but never touching (each spot is tried at random and kept only
  //    if it clears every tile already placed)
  const all = ghosts.map((x) => x.g);
  const c = document.querySelector(".felt")?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const cx = c.left + c.width / 2, cy = Math.min(c.top + c.height / 2, innerHeight * 0.42);
  const n = all.length;
  const maxW = Math.min(c.width || innerWidth, innerWidth - 32) * 0.9, maxH = innerHeight * 0.5;
  const rx = Math.min(maxW / 2, 260), ry = Math.min(rx * 0.74, maxH / 2);
  const w = Math.min(GHOST_W, Math.sqrt((Math.PI * rx * ry) / (n * 1.5 * 2.6)));
  const slots = swirl(n, w, rx, ry).map((t) => ({ x: cx + t.x, y: cy + t.y, rot: t.rot, s: w / GHOST_W }));
  slots.sort((a, b) => a.y - b.y);  // dealing takes tiles from the far side of the pile first
  const order = [...all.keys()].sort(() => Math.random() - 0.5);  // tiles land in a random spot of the pile
  await Promise.all(order.map((gi, i) => move(all[gi], slots[i], 600, Math.min(i * 8, 420))));

  // 3. the whole pile flips face down, a wave across it
  await Promise.all(ghosts.map((x, i) => (x.back ? null : flip(x.g, "", true, Math.min(order.indexOf(i) * 6, 360)))));
  ghosts = order.map((gi) => all[gi]);  // deal from the pile, top row first
  await wait(150);

  // 4. the new game appears underneath (still hidden); in one move every tile goes to its place: each
  //    player's hand, and everything left over onto the wall (the face-down stack with the count)
  startNew();
  await frame();
  const targets = dealOrder();
  while (ghosts.length < targets.length) ghosts.push(makeGhost(layer, { x: cx, y: cy, w, rot: 0 }, "", true));
  const spare = ghosts.splice(targets.length);
  const wallTile = document.querySelector("#discards .dstack.wall .tile");
  const wallAt = wallTile ? place(wallTile) : null;
  await Promise.all([
    ...targets.map((t, i) => {
      const p = place(t);
      return move(ghosts[i], { x: p.x, y: p.y, rot: p.rot, s: p.w / GHOST_W }, 560, Math.random() * 90);
    }),
    ...spare.map((g) => (wallAt
      ? move(g, { x: wallAt.x, y: wallAt.y, rot: wallAt.rot, s: wallAt.w / GHOST_W }, 560, Math.random() * 90)
      : Promise.resolve()).then(() => g.el.remove())),
  ]);

  // 5. your tiles turn face up, then the real table takes over again
  const mine = new Set([...document.querySelectorAll("#hand .tile, #meExposed .tile")]);
  await Promise.all(targets.map((t, i) => (mine.has(t) && !t.classList.contains("back") ? flip(ghosts[i], t.innerHTML, false, i % 14 * 25) : null)));
  body.classList.remove("dealing-hide");
  layer.remove();
  body.classList.remove("dealing");
}
