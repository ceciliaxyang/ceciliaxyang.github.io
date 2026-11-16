// Game state machine. The whole game is one plain, JSON-safe object so it can be cloned
// (for the coach's "take it back") and saved between visits.
//
// Seats: player 0 is you (bottom), 1 sits to your right, 2 across, 3 on your left.
// Play goes 0 → 1 → 2 → 3 (counter-clockwise around the table).
//
// Phases:
//   "draw"  – the current player draws from the wall
//   "act"   – the current player discards, or declares a win / kong
//   "claim" – a discard (or a tile added to a kong) is out; others may claim it
//   "over"  – the hand is finished; state.result says how

import { kindOf, countsOf, scoreWin, shanten, isSuited, isBonus, suitOf, POINTS } from "./engine.js";

export const NAMES = ["You", "Mei", "Jun", "Lin"];
// The last 14 tiles are the dead wall: only kong and flower replacements come from there.
export const DEAD_WALL = 14;
export const liveTiles = (state) => Math.max(0, state.wall.length - DEAD_WALL);

export function createGame({ minFan = 1 } = {}) {
  const state = {
    version: 1,
    minFan,
    players: NAMES.map((name, i) => ({ name, human: i === 0, score: 0, hand: [], melds: [], flowers: [], discards: [] })),
    dealer: 0,
    prevailing: 0,
    handNo: 0,
    roundStartDealer: 0,
    wall: [],
    current: 0,
    phase: "over",
    drawn: null,
    afterClaim: false,
    flags: {},
    lastDiscard: null,
    claim: null,
    pendingKong: null,
    result: null,
    gameOver: false,
    log: [],
  };
  startHand(state);
  return state;
}

export const seatWind = (state, p) => (p - state.dealer + 4) % 4;
export const kindsOf = (ids) => ids.map(kindOf);
export const handCounts = (pl) => countsOf(pl.hand.map(kindOf));

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startHand(state) {
  state.handNo++;
  state.wall = shuffle([...Array(144).keys()]);
  for (const pl of state.players) { pl.hand = []; pl.melds = []; pl.flowers = []; pl.discards = []; }
  for (let i = 0; i < 4; i++) {
    const p = (state.dealer + i) % 4;
    for (let n = 0; n < 13; n++) state.players[p].hand.push(state.wall.shift());
  }
  state.players[state.dealer].hand.push(state.wall.shift());
  state.flags = {};
  for (let i = 0; i < 4; i++) replaceFlowers(state, (state.dealer + i) % 4);
  sortHands(state);
  state.current = state.dealer;
  state.phase = "act";
  state.drawn = null;
  state.afterClaim = false;
  state.flags = { first: true };
  state.lastDiscard = null;
  state.claim = null;
  state.pendingKong = null;
  state.result = null;
  state.log = [];
  log(state, `Hand ${state.handNo}. ${state.players[state.dealer].name} ${state.dealer === 0 ? "are" : "is"} East and deals.`);
}

export function sortHands(state) {
  for (const pl of state.players) pl.hand.sort((a, b) => kindOf(a) - kindOf(b) || a - b);
}

function log(state, msg) {
  state.log.push(msg);
  if (state.log.length > 60) state.log.shift();
}

function replaceFlowers(state, p) {
  const pl = state.players[p];
  let i;
  while ((i = pl.hand.findIndex((id) => isBonus(kindOf(id)))) >= 0) {
    pl.flowers.push(pl.hand.splice(i, 1)[0]);
    if (!state.wall.length) return;
    pl.hand.push(state.wall.pop());
    state.flags.replacement = true;
  }
}

/* Draw for p (from the back of the wall for replacements). Flowers are set aside and
   replaced automatically. Returns the tile id, or null if the wall ran out. */
function draw(state, p, back) {
  const pl = state.players[p];
  while (state.wall.length) {
    const id = back ? state.wall.pop() : state.wall.shift();
    if (isBonus(kindOf(id))) {
      pl.flowers.push(id);
      back = true;
      state.flags.replacement = true;
      continue;
    }
    pl.hand.push(id);
    return id;
  }
  return null;
}

/* ---------------- Rule checks ---------------- */

export function winCheck(state, p, extraKind = null, { selfDraw = false, robbing = false } = {}) {
  const pl = state.players[p];
  const kinds = kindsOf(pl.hand);
  if (extraKind !== null) kinds.push(extraKind);
  const counts = countsOf(kinds);
  if (shanten(counts, pl.melds.length) !== -1) return null;
  const res = scoreWin({
    counts,
    melds: pl.melds.map((m) => ({ type: m.type, k: m.k, concealed: m.concealed })),
    seatWind: seatWind(state, p),
    prevailing: state.prevailing,
    flowers: pl.flowers.map(kindOf),
    selfDraw,
    lastTile: selfDraw && !!state.flags.lastTile,
    replacement: selfDraw && !!state.flags.replacement,
    robbing,
  });
  if (!res) return null;
  return { ...res, legal: res.fan >= state.minFan };
}

export function actOptions(state, p) {
  const pl = state.players[p];
  const opts = { tsumo: null, kongs: [] };
  if (state.phase !== "act" || state.current !== p) return opts;
  if (!state.afterClaim) {
    const w = winCheck(state, p, null, { selfDraw: true });
    if (w) opts.tsumo = w;
    if (state.wall.length) {
      const c = handCounts(pl);
      c.forEach((n, k) => { if (n === 4) opts.kongs.push({ k, type: "concealed" }); });
      pl.melds.forEach((m, i) => { if (m.type === "pung" && c[m.k] >= 1) opts.kongs.push({ k: m.k, type: "add", meld: i }); });
    }
  }
  return opts;
}

export function claimOptions(state, q) {
  const ld = state.lastDiscard;
  if (!ld || q === ld.from) return null;
  const k = kindOf(ld.id);
  const pl = state.players[q];
  const c = handCounts(pl);
  const o = { win: null, pung: false, kong: false, chows: [] };
  const w = winCheck(state, q, k, { robbing: !!ld.robbing });
  if (w && w.legal) o.win = w;
  if (!ld.robbing) {
    if (c[k] >= 2) o.pung = true;
    if (c[k] >= 3 && state.wall.length) o.kong = true;
    if (q === (ld.from + 1) % 4 && isSuited(k)) {
      const n = k % 9;
      const same = (x) => x >= 0 && x < 27 && suitOf(x) === suitOf(k);
      for (const [a, b] of [[k - 2, k - 1], [k - 1, k + 1], [k + 1, k + 2]]) {
        if (same(a) && same(b) && Math.abs(a % 9 - n) <= 2 && Math.abs(b % 9 - n) <= 2 && c[a] && c[b]) o.chows.push([a, b]);
      }
    }
  }
  if (!o.win && !o.pung && !o.kong && !o.chows.length) return null;
  return o;
}

/* ---------------- Actions ---------------- */

export function discard(state, p, id) {
  const pl = state.players[p];
  const i = pl.hand.indexOf(id);
  if (i < 0) throw new Error("tile not in hand");
  pl.hand.splice(i, 1);
  sortHands(state);
  pl.discards.push({ id, taken: false });
  state.lastDiscard = { id, from: p };
  state.drawn = null;
  state.afterClaim = false;
  state.flags = {};
  openClaims(state);
}

function openClaims(state) {
  const options = {};
  for (let q = 0; q < 4; q++) {
    const o = claimOptions(state, q);
    if (o) options[q] = o;
  }
  state.claim = { options, responses: {} };
  state.phase = "claim";
}

export function tsumo(state, p) {
  const w = winCheck(state, p, null, { selfDraw: true });
  if (!w || !w.legal) return false;
  finishWin(state, p, w, { selfDraw: true });
  return true;
}

export function declareKong(state, p, k, type) {
  const pl = state.players[p];
  if (type === "concealed") {
    const ids = pl.hand.filter((id) => kindOf(id) === k);
    pl.hand = pl.hand.filter((id) => kindOf(id) !== k);
    pl.melds.push({ type: "kong", k, tiles: ids, concealed: true, from: p });
    log(state, `${pl.name} declared a concealed kong.`);
    replacementDraw(state, p);
  } else {
    const id = pl.hand.find((x) => kindOf(x) === k);
    pl.hand.splice(pl.hand.indexOf(id), 1);
    const meld = pl.melds.findIndex((m) => m.type === "pung" && m.k === k);
    state.pendingKong = { p, k, id, meld };
    state.lastDiscard = { id, from: p, robbing: true };
    state.drawn = null;
    openClaims(state);
    if (!Object.keys(state.claim.options).length) completeAddKong(state);
  }
}

function completeAddKong(state) {
  const { p, id, meld } = state.pendingKong;
  const pl = state.players[p];
  pl.melds[meld].type = "kong";
  pl.melds[meld].tiles.push(id);
  state.pendingKong = null;
  state.lastDiscard = null;
  state.claim = null;
  log(state, `${pl.name} added to a kong.`);
  replacementDraw(state, p);
}

function replacementDraw(state, p) {
  state.flags = {};
  const id = draw(state, p, true);
  if (id === null) return exhaustive(state);
  state.flags.replacement = true;
  state.current = p;
  state.drawn = id;
  state.afterClaim = false;
  state.phase = "act";
}

/* Response from player q to the open claim: {type: "pass"|"win"|"pung"|"kong"|"chow", chow:[a,b]} */
export function respond(state, q, resp) {
  if (state.phase !== "claim") return;
  state.claim.responses[q] = resp;
}

export function claimPendingFor(state, q) {
  return state.phase === "claim" && state.claim.options[q] && !state.claim.responses[q];
}

/* Once everyone with options has answered, settle the claim by priority. */
export function resolveClaims(state) {
  const { options, responses } = state.claim;
  for (const q of Object.keys(options)) if (!responses[q]) return false;
  const ld = state.lastDiscard;
  const order = [1, 2, 3].map((d) => (ld.from + d) % 4);
  const k = kindOf(ld.id);

  const winner = order.find((q) => responses[q]?.type === "win");
  if (winner !== undefined) {
    const w = winCheck(state, winner, k, { robbing: !!ld.robbing });
    const pl = state.players[winner];
    pl.hand.push(ld.id);
    if (!ld.robbing) markTaken(state, ld);
    sortHands(state);
    finishWin(state, winner, w, { selfDraw: false, from: ld.from });
    return true;
  }
  if (state.pendingKong) { completeAddKong(state); return true; }

  const pungQ = order.find((q) => responses[q]?.type === "pung" || responses[q]?.type === "kong");
  if (pungQ !== undefined) {
    const type = responses[pungQ].type;
    const pl = state.players[pungQ];
    const need = type === "kong" ? 3 : 2;
    const own = pl.hand.filter((id) => kindOf(id) === k).slice(0, need);
    pl.hand = pl.hand.filter((id) => !own.includes(id));
    pl.melds.push({ type, k, tiles: [...own, ld.id], concealed: false, from: ld.from, claimed: ld.id });
    markTaken(state, ld);
    log(state, `${pl.name} ${type === "kong" ? "konged" : "punged"} ${state.players[ld.from].name === "You" ? "your" : state.players[ld.from].name + "'s"} discard.`);
    state.lastDiscard = null;
    state.claim = null;
    if (type === "kong") return replacementDraw(state, pungQ), true;
    state.current = pungQ;
    state.phase = "act";
    state.afterClaim = true;
    state.drawn = null;
    state.flags = {};
    return true;
  }

  const chowQ = order[0];
  if (responses[chowQ]?.type === "chow") {
    const [a, b] = responses[chowQ].chow;
    const pl = state.players[chowQ];
    const ta = pl.hand.find((id) => kindOf(id) === a);
    const tb = pl.hand.find((id) => kindOf(id) === b);
    pl.hand = pl.hand.filter((id) => id !== ta && id !== tb);
    const tiles = [ta, tb, ld.id].sort((x, y) => kindOf(x) - kindOf(y));
    pl.melds.push({ type: "chow", k: Math.min(a, b, k), tiles, concealed: false, from: ld.from, claimed: ld.id });
    markTaken(state, ld);
    log(state, `${pl.name} chowed.`);
    state.lastDiscard = null;
    state.claim = null;
    state.current = chowQ;
    state.phase = "act";
    state.afterClaim = true;
    state.drawn = null;
    state.flags = {};
    return true;
  }

  // nobody claimed
  state.claim = null;
  state.current = (ld.from + 1) % 4;
  state.phase = "draw";
  return true;
}

function markTaken(state, ld) {
  const d = state.players[ld.from].discards.find((x) => x.id === ld.id);
  if (d) d.taken = true;
}

export function drawTurn(state) {
  const p = state.current;
  state.flags = {};
  if (liveTiles(state) === 0) return exhaustive(state);
  const id = draw(state, p, false);
  if (id === null) return exhaustive(state);
  state.drawn = id;
  state.afterClaim = false;
  state.phase = "act";
  if (liveTiles(state) === 0) state.flags.lastTile = true;
}

function exhaustive(state) {
  state.phase = "over";
  state.result = { type: "draw" };
  state.claim = null;
  log(state, "The wall ran out. The hand is a draw.");
}

function finishWin(state, p, w, { selfDraw, from = null }) {
  const pts = POINTS[Math.min(w.fan, POINTS.length - 1)];
  const delta = [0, 0, 0, 0];
  if (selfDraw) {
    for (let q = 0; q < 4; q++) if (q !== p) { delta[q] -= pts; delta[p] += pts; }
  } else {
    delta[from] -= pts * 2;
    delta[p] += pts * 2;
  }
  delta.forEach((d, q) => (state.players[q].score += d));
  state.phase = "over";
  state.claim = null;
  state.result = { type: "win", winner: p, selfDraw, from, fan: w.fan, items: w.items, arrangement: w.arrangement, points: pts, delta };
  const name = state.players[p].name;
  log(state, `${name} won${selfDraw ? " on a self-drawn tile" : " off " + state.players[from].name + "'s discard"} with ${w.fan} fan.`);
}

/* After a hand: rotate the deal unless the dealer won (or the hand was a draw). */
export function nextHand(state) {
  const r = state.result;
  const dealerKeeps = !r || r.type === "draw" || r.winner === state.dealer;
  let roundDone = false;
  if (!dealerKeeps) {
    state.dealer = (state.dealer + 1) % 4;
    if (state.dealer === state.roundStartDealer) {
      state.prevailing = (state.prevailing + 1) % 4;
      roundDone = true;
    }
  }
  startHand(state);
  return roundDone;
}

/* Copies of each kind that player p can't see (for tile-acceptance counts). */
export function unseenFor(state, p) {
  const u = new Array(34).fill(4);
  const see = (id) => { const k = kindOf(id); if (k < 34) u[k]--; };
  state.players.forEach((pl, q) => {
    pl.melds.forEach((m) => m.tiles.forEach(see));
    pl.discards.forEach((d) => { if (!d.taken) see(d.id); });
    if (q === p) pl.hand.forEach(see);
  });
  if (state.phase === "claim" && state.lastDiscard?.robbing) see(state.lastDiscard.id);
  return u.map((x) => Math.max(0, x));
}
