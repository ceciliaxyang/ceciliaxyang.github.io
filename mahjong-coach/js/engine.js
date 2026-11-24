// Pure hand math: tile kinds, shanten (how many tiles from ready), tile acceptance,
// winning-hand decomposition and Hong Kong style fan scoring. No game state lives here.
//
// Tile kinds 0-33 are the playable tiles:
//   0-8 Characters 1-9, 9-17 Circles 1-9, 18-26 Bamboo 1-9,
//   27-30 winds East South West North, 31-33 dragons Red Green White.
// Kinds 34-41 are bonus tiles: Flowers 1-4 then Seasons 1-4.
// Physical tile ids 0-143: four copies of each playable kind (id >> 2), then the 8 bonus tiles.

export const kindOf = (id) => (id < 136 ? id >> 2 : 34 + (id - 136));
export const suitOf = (k) => (k < 27 ? Math.floor(k / 9) : 3); // 0 chars, 1 circles, 2 bamboo, 3 honors
export const numOf = (k) => (k % 9) + 1;
export const isSuited = (k) => k < 27;
export const isHonor = (k) => k >= 27 && k < 34;
export const isDragon = (k) => k >= 31 && k < 34;
export const isWind = (k) => k >= 27 && k <= 30;
export const isBonus = (k) => k >= 34;
export const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function countsOf(kinds) {
  const c = new Array(34).fill(0);
  for (const k of kinds) if (k < 34) c[k]++;
  return c;
}

/* ---------------- Shanten ----------------
   Shanten = how many tile swaps away from ready (tenpai). 0 = ready, -1 = complete.
   `open` is the number of sets already declared (melds), which shrinks what the
   concealed tiles still need to make. */

const memo = new Map();

// Each suit (and the honors) is searched on its own for every (sets, partial sets, pair)
// combination it can make; those per-group results are cached and then combined. Changing one
// tile only changes one group, so analysing a whole hand mostly hits the cache.
const groupMemo = new Map();

// `live[i]` (optional) says whether tile i of this group can still be drawn. A partial set is only
// counted when a tile that finishes it is still live: 6 and 8 aren't a partial run once all four 7s are
// gone, and a pair can't grow into three of a kind when both other copies are. (A pair still counts as
// the hand's pair: it needs nothing more.)
function groupOptions(vec, honors, live = null) {
  const key = (honors ? "h" : "s") + vec.join("") + (live ? "|" + live.map((x) => (x ? 1 : 0)).join("") : "");
  const ok = (j) => !live || (j >= 0 && j < len && live[j]);
  const hit = groupMemo.get(key);
  if (hit) return hit;
  const len = vec.length;
  const v = vec.slice();
  const seen = new Set();
  const out = [];
  function dfs(i, m, t, p) {
    while (i < len && v[i] === 0) i++;
    if (i === len) {
      const id = m * 100 + t * 10 + p;
      if (!seen.has(id)) { seen.add(id); out.push([m, t, p]); }
      return;
    }
    if (v[i] >= 3) { v[i] -= 3; dfs(i, m + 1, t, p); v[i] += 3; }
    if (!honors && i <= 6 && v[i + 1] && v[i + 2]) {
      v[i]--; v[i + 1]--; v[i + 2]--; dfs(i, m + 1, t, p); v[i]++; v[i + 1]++; v[i + 2]++;
    }
    if (v[i] >= 2) {
      v[i] -= 2;
      if (!p) dfs(i, m, t, 1);
      if (t < 4 && ok(i)) dfs(i, m, t + 1, p);
      v[i] += 2;
    }
    if (!honors && t < 4) {
      if (i <= 7 && v[i + 1] && (ok(i - 1) || ok(i + 2))) { v[i]--; v[i + 1]--; dfs(i, m, t + 1, p); v[i]++; v[i + 1]++; }
      if (i <= 6 && v[i + 2] && ok(i + 1)) { v[i]--; v[i + 2]--; dfs(i, m, t + 1, p); v[i]++; v[i + 2]++; }
    }
    v[i]--; dfs(i, m, t, p); v[i]++;
  }
  dfs(0, 0, 0, 0);
  // keep only options not dominated by another (more sets, partials and pair)
  const pruned = out.filter((a) => !out.some((b) => b !== a && b[0] >= a[0] && b[1] >= a[1] && b[2] >= a[2] && (b[0] > a[0] || b[1] > a[1] || b[2] > a[2])));
  if (groupMemo.size > 200000) groupMemo.clear();
  groupMemo.set(key, pruned);
  return pruned;
}

function standardShanten(c, open, live) {
  const key = c.join("") + "|" + open + (live ? "|" + live.map((x) => (x ? 1 : 0)).join("") : "");
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const need = 4 - open;
  const groups = [
    groupOptions(c.slice(0, 9), false, live && live.slice(0, 9)),
    groupOptions(c.slice(9, 18), false, live && live.slice(9, 18)),
    groupOptions(c.slice(18, 27), false, live && live.slice(18, 27)),
    groupOptions(c.slice(27, 34), true, live && live.slice(27, 34)),
  ];
  let best = 8;
  for (const a of groups[0]) for (const b of groups[1]) for (const d of groups[2]) for (const e of groups[3]) {
    let m = a[0] + b[0] + d[0] + e[0];
    let t = a[1] + b[1] + d[1] + e[1];
    const pairs = a[2] + b[2] + d[2] + e[2];
    const p = pairs > 0 ? 1 : 0;
    t += pairs - p; // extra pairs still count as partial sets
    if (m > need) m = need;
    const tt = Math.min(t, need - m);
    const s = 2 * (need - m) - tt - p;
    if (s < best) best = s;
  }
  if (memo.size > 300000) memo.clear();
  memo.set(key, best);
  return best;
}

function sevenPairsShanten(c) {
  let pairs = 0, kinds = 0;
  for (let k = 0; k < 34; k++) {
    if (c[k] >= 1) kinds++;
    if (c[k] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

function orphansShanten(c) {
  let kinds = 0, pair = 0;
  for (const k of ORPHANS) {
    if (c[k] >= 1) kinds++;
    if (c[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

/* `unseen` (optional): copies of each kind still out there. When given, partial sets that can no longer
   be finished don't count, so a hand holding only dead shapes is honestly further from winning. */
export function shanten(c, open = 0, unseen = null) {
  const live = unseen ? unseen.map((x) => x > 0) : null;
  let s = standardShanten(c, open, live);
  if (open === 0) s = Math.min(s, sevenPairsShanten(c), orphansShanten(c));
  return s;
}

/* Which hand shape a concealed hand is closest to: "orphans", "sevenPairs" or "standard". */
export function closestShape(c, open = 0, unseen = null) {
  if (open > 0) return "standard";
  const std = standardShanten(c, 0, unseen ? unseen.map((x) => x > 0) : null);
  const o = orphansShanten(c), sp = sevenPairsShanten(c);
  if (o < std && o <= sp) return "orphans";
  if (sp < std) return "sevenPairs";
  return "standard";
}

/* Tiles that would move a hand (between turns, 13-tile shape) one step closer.
   `unseen[k]` = copies of k the player can't see anywhere (not in their own hand,
   not discarded, not in anyone's melds). */
export function acceptance(c, open, unseen) {
  const s0 = shanten(c, open, unseen);
  const tiles = [];
  let count = 0;
  for (let k = 0; k < 34; k++) {
    if (unseen[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, open, unseen) < s0) { tiles.push(k); count += unseen[k]; }
    c[k]--;
  }
  return { shanten: s0, tiles, count };
}

/* Every discard option for a 14-tile shape, best first. */
export function analyzeDiscards(c, open, unseen) {
  const out = [];
  for (let k = 0; k < 34; k++) {
    if (!c[k]) continue;
    c[k]--;
    const a = acceptance(c, open, unseen);
    c[k]++;
    out.push({ k, shanten: a.shanten, ukeire: a.count, tiles: a.tiles });
  }
  out.sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire);
  return out;
}

/* ---------------- Winning hands ---------------- */

function meldsAll(c, i, sets, out, pair) {
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) { out.push({ pair, sets: sets.slice() }); return; }
  if (c[i] >= 3) {
    c[i] -= 3; sets.push({ type: "pung", k: i });
    meldsAll(c, i, sets, out, pair);
    sets.pop(); c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
    c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ type: "chow", k: i });
    meldsAll(c, i, sets, out, pair);
    sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

/* All ways the concealed tiles (3n+2 of them) split into a pair plus sets. */
export function decompose(counts, open) {
  const c = counts.slice();
  const out = [];
  for (let k = 0; k < 34; k++) {
    if (c[k] >= 2) {
      c[k] -= 2;
      meldsAll(c, 0, [], out, k);
      c[k] += 2;
    }
  }
  if (open === 0) {
    const total = c.reduce((a, b) => a + b, 0);
    if (total === 14 && c.every((x) => x === 0 || x === 2)) out.push({ special: "sevenPairs" });
    if (total === 14 && ORPHANS.every((k) => c[k] >= 1) && c.every((x, k) => x === 0 || ORPHANS.includes(k)))
      out.push({ special: "orphans" });
  }
  return out;
}

/* ---------------- Fan (Hong Kong style, simplified) ---------------- */

export const LIMIT = 13;
export const FAN_GUIDE = [
  ["Self-drawn win", 1, "Win on a tile you drew yourself."],
  ["Concealed hand", 1, "No chows, pengs or kongs claimed from discards."],
  ["No flowers", 1, "You drew no flower or season tiles."],
  ["Seat flower", 1, "Each flower or season whose number matches your seat (East 1, South 2, West 3, North 4)."],
  ["Dragon peng", 1, "Each peng or kong of Red, Green or White dragons."],
  ["Seat wind peng", 1, "Peng or kong of your own seat's wind."],
  ["Round wind peng", 1, "Peng or kong of the round's wind."],
  ["All chows", 1, "Four sequences and a pair."],
  ["Last tile", 1, "Win by drawing the last tile of the wall."],
  ["Win on a replacement", 1, "Win on the tile drawn after a kong or flower."],
  ["Robbing a kong", 1, "Win on the tile someone adds to make a kong."],
  ["All pengs", 3, "Four pengs or kongs and a pair."],
  ["Mixed one suit", 3, "One suit plus honors."],
  ["Seven pairs", 4, "Seven different pairs, fully concealed."],
  ["Small three dragons", 5, "Two dragon pengs and a pair of the third dragon."],
  ["Small four winds", 6, "Three wind pengs and a pair of the fourth wind."],
  ["Pure one suit", 7, "Every tile from a single suit, no honors."],
  ["Big three dragons", 8, "Pengs of all three dragons."],
  ["All honors", LIMIT, "Only winds and dragons. Limit hand."],
  ["Big four winds", LIMIT, "Pengs of all four winds. Limit hand."],
  ["Thirteen orphans", LIMIT, "One of every 1, 9, wind and dragon, plus a pair of any of them. Limit hand."],
];

export const POINTS = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];

const DRAGON_NAMES = ["Red", "Green", "White"];
const WIND_NAMES = ["East", "South", "West", "North"];

/* ctx: { counts: concealed incl. winning tile, melds: [{type, k, concealed}], seatWind, prevailing,
          flowers: [kinds], selfDraw, lastTile, replacement, robbing }
   Returns the best-scoring arrangement, or null if the tiles don't form a winning hand. */
export function scoreWin(ctx) {
  const open = ctx.melds.length;
  const arrangements = decompose(ctx.counts, open);
  if (!arrangements.length) return null;

  const common = [];
  if (ctx.selfDraw) common.push(["Self-drawn win", 1]);
  if (ctx.melds.every((m) => m.concealed)) common.push(["Concealed hand", 1]);
  // "No flowers" only scores when flowers are in the game at all
  if (!ctx.flowers.length && ctx.flowersInPlay !== false) common.push(["No flowers", 1]);
  const seatFlowers = ctx.flowers.filter((f) => (f - 34) % 4 === ctx.seatWind).length;
  if (seatFlowers) common.push(["Seat flower" + (seatFlowers > 1 ? " ×" + seatFlowers : ""), seatFlowers]);
  if (ctx.lastTile && ctx.selfDraw) common.push(["Last tile", 1]);
  if (ctx.replacement && ctx.selfDraw) common.push(["Win on a replacement", 1]);
  if (ctx.robbing) common.push(["Robbing a kong", 1]);

  let best = null;
  for (const arr of arrangements) {
    const items = [...common];
    let limit = false;
    if (arr.special === "orphans") {
      items.length = 0;
      items.push(["Thirteen orphans", LIMIT]);
      limit = true;
    } else {
      const sets = arr.special
        ? []
        : ctx.melds.map((m) => ({ type: m.type === "chow" ? "chow" : "pung", k: m.k })).concat(arr.sets);
      const tiles = [];
      if (arr.special === "sevenPairs") {
        ctx.counts.forEach((n, k) => { if (n) tiles.push(k); });
        items.push(["Seven pairs", 4]);
      } else {
        sets.forEach((s) => tiles.push(s.k));
        tiles.push(arr.pair);
        const pungs = sets.filter((s) => s.type === "pung");
        const dragons = pungs.filter((s) => isDragon(s.k));
        const winds = pungs.filter((s) => isWind(s.k));
        const pairDragon = isDragon(arr.pair);
        const pairWind = isWind(arr.pair);
        if (dragons.length === 3) items.push(["Big three dragons", 8]);
        else if (dragons.length === 2 && pairDragon) items.push(["Small three dragons", 5]);
        else dragons.forEach((s) => items.push([DRAGON_NAMES[s.k - 31] + " dragon peng", 1]));
        if (winds.length === 4) { items.push(["Big four winds", LIMIT]); limit = true; }
        else if (winds.length === 3 && pairWind) items.push(["Small four winds", 6]);
        else {
          winds.forEach((s) => {
            if (s.k - 27 === ctx.seatWind) items.push(["Seat wind peng (" + WIND_NAMES[s.k - 27] + ")", 1]);
            if (s.k - 27 === ctx.prevailing) items.push(["Round wind peng (" + WIND_NAMES[s.k - 27] + ")", 1]);
          });
        }
        if (sets.length === 4 && sets.every((s) => s.type === "chow")) items.push(["All chows", 1]);
        if (pungs.length === 4) items.push(["All pengs", 3]);
      }
      const suits = new Set(tiles.filter(isSuited).map(suitOf));
      const honors = tiles.some(isHonor);
      if (suits.size === 0) { items.push(["All honors", LIMIT]); limit = true; }
      else if (suits.size === 1 && !honors) items.push(["Pure one suit", 7]);
      else if (suits.size === 1 && honors) items.push(["Mixed one suit", 3]);
    }
    let fan = items.reduce((a, [, f]) => a + f, 0);
    if (limit || fan > LIMIT) fan = LIMIT;
    if (!best || fan > best.fan) best = { fan, items, arrangement: arr, limit: fan === LIMIT };
  }
  return best;
}
