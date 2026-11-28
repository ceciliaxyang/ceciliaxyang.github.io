// New-game transition: the buttons and labels fade away, every tile slides into a "mid-shuffle swirl" in the
// middle (scattered at every angle, but never overlapping, like real tiles), the pile flips face down, then in one
// move every tile goes to its player or onto the wall, and your own tiles turn face up. The real table is hidden
// underneath until the last tile lands. Skipped entirely for people who prefer reduced motion.

import { clack, shuffleRattle } from "./sound.js";
import { faceSvg } from "./tiles.js";

const GHOST_W = 40;  // every flying tile is drawn at this width and scaled to fit where it is or goes
/* A loose tile's 3D edge (see .deal-layer .tile in style.css) is drawn straight down the screen whatever its
   angle, --depth of its width plus a 1px rim. Its footprint on the table is its face swept down by that much:
   the face rectangle's extent along an axis, plus half the edge's drop projected on it (the centre moves down by
   the other half, the same for every tile, so it cancels out between two tiles). The extra axis (1, 0) is the
   sweep's own side. */
const DEPTH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--depth")) || 0.24;
const dropOf = (w) => w * DEPTH + 1;
const footAxes = (ra, rb) => [[Math.cos(ra), Math.sin(ra)], [-Math.sin(ra), Math.cos(ra)], [Math.cos(rb), Math.sin(rb)], [-Math.sin(rb), Math.cos(rb)], [1, 0]];
const footExt = (hw, hh, drop) => (r, ux, uy) => hw * Math.abs(Math.cos(r) * ux + Math.sin(r) * uy) + hh * Math.abs(-Math.sin(r) * ux + Math.cos(r) * uy) + (drop / 2) * Math.abs(uy);
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
/* Put a tile where it is: its position, and its angle for the CSS that keeps its shadow and shading falling the
   same way as every other tile's (see .deal-layer .tile in style.css). */
const setPlace = (g) => { g.el.style.transform = transform(g); g.el.style.setProperty("--rot", `${g.rot}deg`); };

function move(g, to, duration, delay = 0, easing = "cubic-bezier(.3, .7, .2, 1)") {
  const from = transform(g), rot0 = `${g.rot}deg`;
  Object.assign(g, to);
  const anim = g.el.animate([{ transform: from, "--rot": rot0 }, { transform: transform(g), "--rot": `${g.rot}deg` }], { duration, delay, easing, fill: "forwards" });
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
  // 3. over the top and down onto the other face, settling with a little bounce (and a soft clack as it lands)
  clack(0.17, 0.18 + Math.random() * 0.12);
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
  setPlace(g);
  return g;
}

/* Hands mixing the scattered pile: a hand presses on a group of neighbouring tiles and shoves it a short way (a
   couple of tile-widths, turning it a little); any tile in its way is pushed aside, and pushes the tiles it meets
   in turn. Pushes start every so often in different parts of the pile, overlapping in time. Tiles only ever slide along the table:
   each is a solid w × 1.5w rectangle at its own angle and none ever overlaps another. If the tiles ahead are
   jammed, the hand moves on less (or waits) rather than squeezing them. Pushed tiles keep the angle they lie at,
   and once the mixing has loosened the pile, hands gather the stray tiles at its edge back in, so it keeps its size.
   Runs until stop(); resolves once the push in progress ends. */
function pushShuffle(ghosts, pile) {
  const n = ghosts.length, GAP = 1, EPS = 0.01;  // px kept clear between tiles; rounding tolerance
  const hw = pile.w / 2 + GAP / 2, hh = pile.w * 0.75 + GAP / 2;
  const extOf = footExt(hw, hh, dropOf(pile.w));  // face plus its 3D edge, so no edge is drawn over a neighbour
  const norm = (g) => Math.hypot((g.x - pile.cx) / pile.rx, (g.y - pile.cy) / pile.ry);
  const spread = () => ghosts.reduce((m, g) => m + norm(g), 0) / n;
  const spread0 = spread();
  const edge0 = Math.max(...ghosts.map(norm));  // the pile's edge as it started

  /* how far b must move to be clear of a ({ x, y }), or null if they don't touch (separating-axis test) */
  function overlap(a, b) {
    const ra = (a.rot * Math.PI) / 180, rb = (b.rot * Math.PI) / 180;
    const axes = footAxes(ra, rb);
    const dx = b.x - a.x, dy = b.y - a.y;
    let best = Infinity, bx = 0, by = 0;
    for (const [ux, uy] of axes) {
      const ext = (r) => extOf(r, ux, uy);
      const d = dx * ux + dy * uy, o = ext(ra) + ext(rb) - Math.abs(d);
      if (o <= EPS) return null;  // touching (or a rounding error's worth) is fine
      if (o < best) { best = o; const sg = d < 0 ? -1 : 1, p = o + EPS; bx = ux * p * sg; by = uy * p * sg; }
    }
    return { x: bx, y: by };
  }
  const near = (a, b) => Math.abs(a.x - b.x) < pile.w * 2.5 && Math.abs(a.y - b.y) < pile.w * 2.5;
  /* how far b must move along (ux, uy) to be clear of a, or Infinity if moving that way can't clear it */
  function along(a, b, ux, uy) {
    const ra = (a.rot * Math.PI) / 180, rb = (b.rot * Math.PI) / 180;
    const axes = footAxes(ra, rb);
    const dx = b.x - a.x, dy = b.y - a.y;
    let best = Infinity;
    for (const [ax, ay] of axes) {
      const ext = (r) => extOf(r, ax, ay);
      const d = dx * ax + dy * ay, o = ext(ra) + ext(rb) - Math.abs(d);
      const rate = (ux * ax + uy * ay) * (d < 0 ? -1 : 1);  // how fast moving along u opens this gap
      if (rate > 0.05) best = Math.min(best, (o + EPS) / rate);
    }
    return best;
  }

  /* push every overlapping tile clear. Pushes travel outward from the hand: tiles under it never give way, and
     between two loose tiles the one further from the hand (in steps of touching tiles) gives way. Returns true
     once nothing overlaps. */
  function settle(held, dirOf) {
    for (let pass = 0; pass < 40; pass++) {
      const depth = new Array(n).fill(Infinity), queue = [...held];
      held.forEach((i) => { depth[i] = 0; });
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        for (let j = 0; j < n; j++) {
          if (depth[j] !== Infinity || !near(ghosts[i], ghosts[j]) || !overlap(ghosts[i], ghosts[j])) continue;
          depth[j] = depth[i] + 1; queue.push(j);
        }
      }
      let moved = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (held.has(i) && held.has(j)) continue;
        const a = ghosts[i], b = ghosts[j];
        if (!near(a, b)) continue;
        const m = overlap(a, b);
        if (!m) continue;
        moved = true;
        // a tile the hand's group runs into is pushed on the way the hand is going (as a palm shoves it), so it
        // can't get wedged between two of the group's tiles; tiles further on are pushed the shortest way clear
        const hi = held.has(i), hj = held.has(j);
        if (hi || hj) {
          const [h, l] = hi ? [a, b] : [b, a];
          const [ux, uy] = dirOf(hi ? i : j);
          const t = along(h, l, ux, uy);
          if (t < pile.w * 3) { l.x += ux * t; l.y += uy * t; continue; }
        }
        if (depth[i] < depth[j]) { b.x += m.x; b.y += m.y; }
        else if (depth[j] < depth[i]) { a.x -= m.x; a.y -= m.y; }
        else { a.x -= m.x / 2; a.y -= m.y / 2; b.x += m.x / 2; b.y += m.y / 2; }
      }
      if (!moved) return true;
    }
    return false;
  }
  const snap = () => ghosts.map((g) => [g.x, g.y, g.rot]);
  const restore = (st) => st.forEach(([x, y, rot], i) => Object.assign(ghosts[i], { x, y, rot }));

  /* A new hand: where it presses, which tiles move with it, and which way. Avoids tiles another hand is already
     moving, and keeps a little away from the other hands. Returns null if there's no room for one right now. */
  function newHand(busy, others) {
    let a0, hand, tang, dist;
    const spin = (Math.random() - 0.5) * 30;
    // which way the pile as a whole has drifted (px), and any tile that has strayed past its edge
    const free = [...ghosts.keys()].filter((i) => !busy.has(i));
    const mx = ghosts.reduce((m, g) => m + g.x, 0) / n - pile.cx, my = ghosts.reduce((m, g) => m + g.y, 0) / n - pile.cy;
    const drift = Math.hypot(mx, my);
    const strays = free.filter((i) => norm(ghosts[i]) > edge0 * 1.02).sort((i, j) => norm(ghosts[j]) - norm(ghosts[i]));
    for (let attempt = 0; attempt < 6; attempt++) {
      if (strays.length && attempt < 3) {
        // a stray first: brought straight back inside the pile's edge
        const out = ghosts[strays[Math.min(attempt, strays.length - 1)]];
        hand = { x: out.x, y: out.y };
        tang = Math.atan2(pile.cy - out.y, pile.cx - out.x) + (Math.random() - 0.5) * 0.3;
        dist = Math.min(4, Math.max(1.8, (norm(out) - edge0 * 0.8) * Math.min(pile.rx, pile.ry) / pile.w)) * pile.w;
      } else if (drift > pile.w * 0.4) {
        // the pile has drifted one way: tiles on that side are pushed back towards the middle
        const ux = mx / drift, uy = my / drift;
        const side = free.slice().sort((i, j) => ((ghosts[j].x - pile.cx) * ux + (ghosts[j].y - pile.cy) * uy) - ((ghosts[i].x - pile.cx) * ux + (ghosts[i].y - pile.cy) * uy));
        const g = ghosts[side[Math.floor(Math.random() * Math.min(6, side.length))]];
        if (!g) return null;
        hand = { x: g.x, y: g.y };
        tang = Math.atan2(-uy, -ux) + (Math.random() - 0.5) * 0.5;
        dist = (2 + Math.random()) * pile.w;
      } else if (spread() > spread0 * 1.04 && Math.random() < 0.75) {
        // gathering: once the mixing has loosened the pile, a hand sweeps stray tiles at its edge back in
        const out = ghosts.filter((g, i) => !busy.has(i)).sort((a, b) => norm(b) - norm(a))[Math.floor(Math.random() * 4)];
        if (!out) return null;
        hand = { x: out.x, y: out.y };
        tang = Math.atan2(pile.cy - out.y, pile.cx - out.x) + (Math.random() - 0.5) * 0.5;
        dist = Math.min(4, Math.max(1.6, (norm(out) - 0.5) * 5)) * pile.w;
      } else {
        // mixing: a spot in the pile, a group pushed a couple of tile-widths, mostly round the pile (nearer the
        // edge, a little more inward)
        a0 = Math.random() * Math.PI * 2;
        const rr = 0.2 + Math.random() * 0.6;
        hand = { x: pile.cx + Math.cos(a0) * rr * pile.rx, y: pile.cy + Math.sin(a0) * rr * pile.ry };
        const side = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2) * (1.15 - rr) + (Math.random() - 0.5) * 0.6;
        // from straight in (side 0) to round the pile (side ±90°); if the pile has drawn in tighter than it started,
        // from straight out instead, so it keeps its size both ways
        tang = a0 + (spread() < spread0 * 0.94 ? 0 : Math.PI) + side;
        if (drift > pile.w * 0.15) {
          // lean the push against any drift, so mixing never carries the pile off one way
          const lean = Math.min(1.2, drift / pile.w);
          const vx = Math.cos(tang) - (mx / drift) * lean, vy = Math.sin(tang) - (my / drift) * lean;
          tang = Math.atan2(vy, vx);
        }
        dist = (1.8 + Math.random() * 1.4) * pile.w;
      }
      if (others.every((o) => Math.hypot(o.x - hand.x, o.y - hand.y) > pile.w * 5)) break;
      if (attempt === 5) return null;
    }
    // everything under the palm moves with it: the few tiles nearest the hand, plus any tile that sits among them
    // (otherwise one left behind in the middle of the group would be squeezed from both sides)
    const byDist = [...ghosts.keys()].filter((i) => !busy.has(i))
      .sort((i, j) => Math.hypot(ghosts[i].x - hand.x, ghosts[i].y - hand.y) - Math.hypot(ghosts[j].x - hand.x, ghosts[j].y - hand.y));
    let group = byDist.slice(0, 4 + Math.floor(Math.random() * 4));
    for (let grew = true; grew;) {
      const cx0 = group.reduce((m, i) => m + ghosts[i].x, 0) / group.length, cy0 = group.reduce((m, i) => m + ghosts[i].y, 0) / group.length;
      const reach = Math.max(...group.map((i) => Math.hypot(ghosts[i].x - cx0, ghosts[i].y - cy0))) + pile.w * 0.6;
      const more = byDist.filter((i) => !group.includes(i) && Math.hypot(ghosts[i].x - cx0, ghosts[i].y - cy0) < reach);
      grew = more.length > 0 && group.length < 12;
      if (grew) group = group.concat(more).slice(0, 12);
    }
    const k = group.length;
    const from = group.map((i) => ({ x: ghosts[i].x, y: ghosts[i].y, rot: ghosts[i].rot }));
    const gx = from.reduce((m, f) => m + f.x, 0) / k, gy = from.reduce((m, f) => m + f.y, 0) / k;
    const dur = 650 + Math.random() * 250;
    shuffleRattle(dur / 1000, 6);
    return {
      x: hand.x, y: hand.y, group, dir: [Math.cos(tang), Math.sin(tang)], dur, t0: performance.now(), done: 0,
      // the group moves as one piece: along the push, turning a little about its middle
      place(e) {
        const ph = (spin * e * Math.PI) / 180, c = Math.cos(ph), sn = Math.sin(ph);
        const ox = Math.cos(tang) * dist * e, oy = Math.sin(tang) * dist * e;
        group.forEach((gi, m) => {
          const dx = from[m].x - gx, dy = from[m].y - gy;
          Object.assign(ghosts[gi], { x: gx + dx * c - dy * sn + ox, y: gy + dx * sn + dy * c + oy, rot: from[m].rot + spin * e });
        });
      },
    };
  }

  // Several hands at once: a new push starts every so often, often before the last has finished (at most three
  // going at a time). Every frame each hand moves on as far as it can without squeezing any tile, so if two
  // groups would run into each other, one of them simply waits.
  const hands = [];
  let running = true, nextStart = performance.now() + 350, stopped;
  const finished = new Promise((r) => { stopped = r; });
  let state = snap();
  const frame = (now) => {
    if (running && now >= nextStart && hands.length < 3) {
      const busy = new Set(hands.flatMap((h) => h.group));
      const h = newHand(busy, hands);
      if (h) hands.push(h);
      nextStart = now + 280 + Math.random() * 420;
    }
    const owner = new Map();
    hands.forEach((h) => h.group.forEach((i) => owner.set(i, h)));
    const held = new Set(owner.keys());
    const dirOf = (i) => owner.get(i).dir;
    for (const h of shuffle(hands.slice())) {
      const p = Math.min(1, (now - h.t0) / h.dur), e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      for (const tryE of [e, h.done + (e - h.done) / 2, h.done + (e - h.done) / 4]) {
        restore(state);
        h.place(tryE);
        // two hands' groups can't push each other: if this one would touch another's, it waits
        const blocked = h.group.some((i) => hands.some((o) => o !== h && o.group.some((j) => near(ghosts[i], ghosts[j]) && overlap(ghosts[i], ghosts[j]))));
        if (!blocked && settle(held, dirOf)) { h.done = tryE; state = snap(); break; }
      }
      restore(state);
      if (p >= 1) h.over = true;
    }
    for (let q = hands.length - 1; q >= 0; q--) if (hands[q].over) hands.splice(q, 1);
    for (const g of ghosts) setPlace(g);
    if (running || hands.length) requestAnimationFrame(frame); else stopped();
  };
  requestAnimationFrame(frame);
  // Start pressed: no new hands; the pushes already going finish
  return { stop: () => { running = false; return finished; } };
}

/* NOT USED right now (kept for another time): the swirl.
   Hands mixing the tiles, like at a real table, where tiles only slide along it and never over or under each other.
   The tiles lie in loose bands round the middle (irregular gaps and offsets, so it still looks scattered), and
   the hands swirl the bands slowly round, neighbouring bands opposite ways, so tiles slide past each other.
   No tile can ever touch another: bands are far enough apart that no tile reaches the next band whatever their
   angles, and tiles within a band keep their spacing as it turns. Runs until stop(); resolves once the tiles
   have glided to a stop. */
// eslint-disable-next-line no-unused-vars
function swirlShuffle(ghosts, pile) {
  const n = ghosts.length, TAU = Math.PI * 2;
  const cx = pile.cx, cy = pile.cy;
  const maxR = Math.min(innerWidth / 2 - 16, Math.max(pile.rx, pile.ry) * 1.05);

  // the bands for tile width w: f = a tile's reach from its centre (half its diagonal, plus a hair), each band
  // `jit` deep, bands 2f apart so nothing in one can reach the next
  const plan = (w) => {
    const f = Math.hypot(w / 2, w * 0.75) * 1.04, jit = w * 0.3, P = 2 * f + jit;
    const bands = [];
    let cap = 0;
    for (let k = 0; cap < n; k++) {
      const rho = P * 0.9 + k * P, min = 2 * Math.asin(Math.min(1, f / (rho - jit / 2))) * 1.03;
      const room = Math.floor(TAU / (min * 1.12));  // room for this many, with space to spare for hops
      bands.push({ rho, min, room, phi: 0, dir: k % 2 ? -1 : 1 });  // neighbouring bands drift opposite ways
      cap += room;
    }
    return { f, jit, bands, outer: bands[bands.length - 1].rho + jit / 2 + f };
  };
  let w = pile.w * 1.15, P0;
  while ((P0 = plan(w)).outer > maxR && w > 8) w -= 0.25;
  const { f, jit, bands } = P0;
  pile.bottom = cy + P0.outer;  // the Start button goes below this
  const s = w / GHOST_W;

  // share the tiles out (in proportion to room) and lay each band out with random gaps
  const total = bands.reduce((m, b) => m + b.room, 0);
  let left = n;
  const tiles = ghosts.map((g) => ({ g, band: 0, th: 0, r: 0, rot0: g.rot }));
  let ti = 0;
  bands.forEach((b, k) => {
    const m = k === bands.length - 1 ? left : Math.min(left, Math.round((b.room / total) * n));
    left -= m;
    const slack = TAU - m * b.min;
    const cuts = Array.from({ length: m }, () => Math.random());
    const sum = cuts.reduce((a, c) => a + c, 0) || 1;
    let th = Math.random() * TAU;
    for (let q = 0; q < m; q++) {
      Object.assign(tiles[ti++], { band: k, th, r: b.rho + (Math.random() - 0.5) * jit });
      th += b.min + (slack * cuts[q]) / sum;
    }
  });
  const pos = (t) => {
    const b = bands[t.band], a = t.th + b.phi;
    return { x: cx + Math.cos(a) * t.r, y: cy + Math.sin(a) * t.r, rot: t.rot0 + (b.phi * 180) / Math.PI, s };
  };
  const draw = () => tiles.forEach((t) => { Object.assign(t.g, pos(t)); setPlace(t.g); });
  draw();


  // the hands swirl the bands slowly and steadily, neighbouring bands opposite ways. Every few seconds a band eases
  // to a new pace (now and then slowing to a stop and turning back), so the swirl never looks mechanical.
  // Speeds are in tile-widths a second along the band.
  const speed = bands.map((b, k) => ({ v: 0, target: (k % 2 ? -1 : 1) * (0.5 + Math.random() * 0.5), next: 0 }));
  let running = true, done;
  const finished = new Promise((r) => { done = r; });
  let last = 0, t = 0;
  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now; t += dt;
    let moving = false;
    bands.forEach((b, k) => {
      const sp = speed[k];
      if (running && t > sp.next) {
        const keep = Math.random() < 0.85 ? Math.sign(sp.target) || 1 : -Math.sign(sp.target);
        sp.target = keep * (0.4 + Math.random() * 0.6);
        sp.next = t + 2.5 + Math.random() * 3;
      }
      const goal = running ? sp.target : 0;
      sp.v += (goal - sp.v) * Math.min(1, dt * (running ? 0.8 : 5));  // ease to the new pace (quickly to a stop)
      b.phi += ((sp.v * w) / b.rho) * dt;
      if (Math.abs(sp.v) > 0.01) moving = true;
    });
    draw();
    if (running || moving) requestAnimationFrame(frame); else done();
  }
  // let the tiles finish fading in, then start swirling (it builds up gently from still)
  setTimeout(() => requestAnimationFrame(frame), 500);
  return { stop: () => { running = false; return finished; } };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* Scatter n tiles (w wide, 1.5w tall, plus their 3D edge) at any angle across an rx × ry oval with none touching. */
function swirl(n, w, rx, ry) {
  const margin = w * 0.08;
  const extOf = footExt(w / 2 + margin / 2, w * 0.75 + margin / 2, dropOf(w));
  const apart = (a, b) => {  // separating-axis test on the two footprints
    const ra = (a.rot * Math.PI) / 180, rb = (b.rot * Math.PI) / 180, dx = b.x - a.x, dy = b.y - a.y;
    return footAxes(ra, rb).some(([ux, uy]) => extOf(ra, ux, uy) + extOf(rb, ux, uy) <= Math.abs(dx * ux + dy * uy));
  };
  const placed = [];
  let grow = 1;
  while (placed.length < n) {
    let ok = false;
    for (let tries = 0; tries < 400 && !ok; tries++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random());
      const t = { x: Math.cos(a) * d * rx * grow, y: Math.sin(a) * d * ry * grow, rot: Math.random() * 360 - 180 };
      if (placed.every((q) => apart(t, q))) { placed.push(t); ok = true; }
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

/* Where the pile goes: the middle of the table. Its tiles are the same size as the opponents' tiles in play
   (--opp), so the deal doesn't shrink or swell them much; the oval grows to fit n of them without touching, up to
   most of the screen (above the Start button). With `fewer` (the start screen), if n won't fit at that size it
   shows as many as do; otherwise (a new game, where every tile on the table must gather) the tiles shrink to fit. */
function pileLayout(n, fewer = false, area = null) {
  // phones: centred in the screen (the sheet is tucked away); larger screens: the middle of the table.
  // `area` (the start screen): fill this box instead ({ left, top, width, height }; it may run off the top)
  const phone = matchMedia("(max-width: 600px)").matches;
  const c = area || (phone ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
    : document.querySelector(".felt")?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight });
  const cx = c.left + c.width / 2, cy = area ? c.top + c.height / 2 : phone ? innerHeight * 0.46 : Math.min(c.top + c.height / 2, innerHeight * 0.42);
  const maxW = Math.min(c.width || innerWidth, innerWidth - 32) * 0.9;
  // room below for the Start button (36px gap + 48px button + a margin), or the whole box when given one
  const maxH = area ? c.height : Math.max(120, 2 * Math.min(cy - 16, innerHeight - cy - 36 - 48 - 24));
  const opp = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--opp")) || GHOST_W;
  const target = Math.min(GHOST_W, opp);
  const PACK = 1.5 * 2.6;  // area each tile needs in the swirl, in tile-widths squared
  // the oval n tiles of the target size need (a little wider than tall), within the room there is
  let rx = Math.sqrt((n * PACK * target * target) / (Math.PI * 0.74)), ry = rx * 0.74;
  if (rx > maxW / 2) { rx = maxW / 2; ry = Math.min(maxH / 2, (n * PACK * target * target) / (Math.PI * rx)); }
  if (ry > maxH / 2) { ry = maxH / 2; rx = Math.min(maxW / 2, (n * PACK * target * target) / (Math.PI * ry)); }
  let w = Math.min(target, Math.sqrt((Math.PI * rx * ry) / (n * PACK)));
  if (fewer && w < target) { w = target; n = Math.max(12, Math.floor((Math.PI * rx * ry) / (PACK * w * w))); }
  const slots = swirl(n, w, rx, ry).map((t) => ({ x: cx + t.x, y: cy + t.y, rot: t.rot, s: w / GHOST_W }));
  slots.sort((a, b) => a.y - b.y);  // dealing takes tiles from the far side of the pile first
  return { cx, cy, rx, ry, w, slots };
}

function newLayer() {
  const layer = document.createElement("div");
  layer.className = "deal-layer";
  document.body.appendChild(layer);
  return layer;
}

/* The new game appears underneath (still hidden); in one move every tile goes to its place (each player's
   hand, everything left over onto the wall), your tiles turn face up, then the real table takes over. */
async function dealFromPile(layer, ghosts, pile, startNew, hooks) {
  const body = document.body;
  startNew();
  await frame();
  if (hooks.beforeDeal) await hooks.beforeDeal();
  // phones: the sheet is still below the screen, so tiles headed into it aim for where it will be once it's up
  const shift = hooks.sheetShift ? hooks.sheetShift() : 0;
  const sheet = document.getElementById("sheet");
  const at = (t) => { const p = place(t); if (shift && sheet?.contains(t)) p.y -= shift; return p; };
  layer.classList.add("flying");  // tiles in flight pass over the sheet and buttons
  shuffleRattle(0.6, 24);  // tiles landing in front of each player
  const targets = dealOrder();
  while (ghosts.length < targets.length) ghosts.push(makeGhost(layer, { x: pile.cx, y: pile.cy, w: pile.w, rot: 0 }, "", true));
  const spare = ghosts.splice(targets.length);
  const wallTile = document.querySelector("#discards .dstack.wall .tile");
  const wallAt = wallTile ? place(wallTile) : null;
  await Promise.all([
    ...targets.map((t, i) => {
      const p = at(t);
      return move(ghosts[i], { x: p.x, y: p.y, rot: p.rot, s: p.w / GHOST_W }, 560, Math.random() * 90);
    }),
    ...spare.map((g) => (wallAt
      ? move(g, { x: wallAt.x, y: wallAt.y, rot: wallAt.rot, s: wallAt.w / GHOST_W }, 560, Math.random() * 90)
      : Promise.resolve()).then(() => g.el.remove())),
  ]);
  if (hooks.afterLand) {
    // phones: everyone else's tiles hand over to the real ones (which sit under the sheet) before the sheet rises,
    // so only your own tiles stay on top of it
    body.classList.add("table-ready");
    targets.forEach((t, i) => { if (!sheet?.contains(t)) ghosts[i].el.remove(); });
    await hooks.afterLand();  // now the sheet rises up behind your tiles
  }
  const mine = new Set([...document.querySelectorAll("#hand .tile, #meExposed .tile")]);
  await Promise.all(targets.map((t, i) => (mine.has(t) && !t.classList.contains("back") ? flip(ghosts[i], t.innerHTML, false, i % 14 * 25) : null)));
  body.classList.remove("dealing-hide", "table-ready");
  layer.remove();
  body.classList.add("undealing");  // buttons and labels fade back in, last
  body.classList.remove("dealing");
  setTimeout(() => body.classList.remove("undealing"), 450);
}

/* New game: clear the table, gather every tile into the swirl, flip it face down, then deal. */
export async function dealAnimation(startNew, hooks = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { startNew(); return; }
  const body = document.body;
  const layer = newLayer();
  // your own tiles (in the phone's sheet) get a layer above the sheet, so they can leave it as it goes down;
  // everyone else's stay under the sheet
  const top = newLayer();
  top.classList.add("flying");
  const sheet = document.getElementById("sheet");

  // 1. buttons and labels fade away; the real tiles hand over to stand-ins
  body.classList.add("dealing");
  const ghosts = visibleTiles().map((t) => {
    const back = t.classList.contains("back") || t.classList.contains("face-down");
    const mine = !!sheet?.contains(t);
    return { g: makeGhost(mine ? top : layer, place(t), t.innerHTML, back), back, mine };
  });
  body.classList.add("dealing-hide");
  // phones: the sheet slides down while the tiles gather
  const tucked = hooks.beforePile ? hooks.beforePile() : null;
  await wait(280);

  // 2. every tile slides into the middle in a "mid-shuffle swirl": scattered at every angle across an
  //    oval, like hands mixing the tiles, but never touching. Your own tiles take the spots nearest the centre.
  const all = ghosts.map((x) => x.g);
  const pile = pileLayout(all.length);
  const byCentre = [...pile.slots.keys()].sort((a, b) =>
    Math.hypot(pile.slots[a].x - pile.cx, pile.slots[a].y - pile.cy) - Math.hypot(pile.slots[b].x - pile.cx, pile.slots[b].y - pile.cy));
  const mineIdx = [...all.keys()].filter((i) => ghosts[i].mine);
  const otherIdx = [...all.keys()].filter((i) => !ghosts[i].mine).sort(() => Math.random() - 0.5);
  const slotOf = new Map();
  mineIdx.forEach((gi, k) => slotOf.set(gi, byCentre[k]));
  const rest = byCentre.slice(mineIdx.length).sort(() => Math.random() - 0.5);
  otherIdx.forEach((gi, k) => slotOf.set(gi, rest[k]));
  // `order` = ghosts in slot order (the deal takes tiles from the far side of the pile first)
  const order = [...all.keys()].sort((a, b) => slotOf.get(a) - slotOf.get(b));
  shuffleRattle(1.05, Math.min(60, all.length));  // the clatter of tiles being swept together and mixed
  await Promise.all([
    ...[...mineIdx, ...otherIdx].map((gi, i) => move(all[gi], pile.slots[slotOf.get(gi)], 600, Math.min(i * 8, 420))),
    tucked,
  ]);

  // 3. the whole pile flips face down, a wave across it
  await Promise.all(ghosts.map((x, i) => (x.back ? null : flip(x.g, "", true, Math.min(order.indexOf(i) * 6, 360)))));
  await wait(150);

  // 4–5. deal
  await dealFromPile(layer, order.map((gi) => all[gi]), pile, startNew, hooks);
  top.remove();
}

/* First visit: the table starts as a face-up pile, slowly swirling, with a "Start new game" button under it.
   Pressing it stops the swirl, flips the pile face down and deals the game (`startNew` renders it underneath).
   Resolves once the real table is showing. */
export async function introDeal(startNew, hooks = {}) {
  const body = document.body;
  body.classList.add("dealing", "dealing-hide");
  if (hooks.beforePile) await hooks.beforePile();
  const layer = newLayer();
  // the landing (Figma 2450:36099): a warm table, the pile running off the top, the name, then Start new game
  body.classList.add("landing");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn deal-start";
  btn.textContent = "Start new game";
  const title = document.createElement("h1");
  title.className = "landing-title";
  title.textContent = "Mahjong Coach";
  layer.append(title, btn);
  // listen from the moment the button shows: a tap while the title font is still loading still starts the game
  const started = new Promise((resolve) => btn.addEventListener("click", resolve, { once: true }));
  try { await document.fonts.load('200px "Instrument Serif"'); } catch { /* fine without it */ }
  const tTop = title.getBoundingClientRect().top;
  // the pile fills the space above the name, starting a little above the top of the screen
  let pile = pileLayout(60, true, { left: 0, top: -0.04 * innerHeight, width: innerWidth, height: tTop + 0.04 * innerHeight - 8 });
  // phones (Figma 2454:37387): the same pile at twice the size about the middle of the screen, so the tiles
  // are big enough to read and the pile runs off the sides and the top
  if (matchMedia("(max-width: 760px)").matches) {
    const k = 2, ox = innerWidth / 2, oy = innerHeight / 2;
    const at = (x, y) => ({ x: ox + (x - ox) * k, y: oy + (y - oy) * k });
    pile = { ...pile, ...at(pile.cx, pile.cy), rx: pile.rx * k, ry: pile.ry * k, w: pile.w * k,
      slots: pile.slots.map((p) => ({ ...p, ...at(p.x, p.y), s: p.s * k })) };
    pile.cx = pile.x; pile.cy = pile.y;
  }
  // the tiles start face up, like a set just tipped out of its box (a fair random mix of the 136 playable tiles)
  const kinds = shuffle(Array.from({ length: 136 }, (_, i) => i >> 2));
  const ghosts = pile.slots.map((p, i) => makeGhost(layer, { x: p.x, y: p.y, w: pile.w, rot: p.rot }, faceSvg(kinds[i]), false));
  ghosts.forEach((g, i) => g.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: i * 6, fill: "backwards" }));
  // a moment face up, then the pile is turned face down in a wave and hands start mixing it, as at a real table
  const idle = matchMedia("(prefers-reduced-motion: reduce)").matches ? { stop: async () => {} } : (() => {
    let mixing = null, stopping = false;
    const ready = (async () => {
      await wait(1300);
      await Promise.all(ghosts.map((g, i) => flip(g, "", true, Math.min(i * 6, 360))));
      // hand the tiles back from the flip's animation to their own position, so the mixing can move them
      ghosts.forEach((g) => { setPlace(g); g.el.getAnimations().forEach((a) => a.cancel()); });
      if (!stopping) mixing = pushShuffle(ghosts, pile);
    })();
    // Start pressed: let a flip in progress finish, and the pushes already going land
    return { stop: async () => { stopping = true; await ready; if (mixing) await mixing.stop(); } };
  })();
  await started;
  await idle.stop();
  btn.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished.then(() => btn.remove());
  title.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished.then(() => title.remove());
  body.classList.remove("landing");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    startNew();
    if (hooks.afterLand) await hooks.afterLand();
    layer.remove();
    body.classList.remove("dealing", "dealing-hide");
    return;
  }
  // any tiles still face up flip face down in a wave (if Start came before the mixing began), then the deal
  await Promise.all(ghosts.map((g, i) => (g.el.classList.contains("back") ? null : flip(g, "", true, Math.min(i * 6, 360)))));
  await wait(150);
  await dealFromPile(layer, ghosts, pile, startNew, hooks);
}
