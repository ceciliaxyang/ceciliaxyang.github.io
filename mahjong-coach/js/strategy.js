// Move evaluation shared by the bots (to play) and the coach (to judge your moves).
import { kindOf, countsOf, shanten, acceptance, analyzeDiscards, isHonor, isDragon, isSuited, suitOf } from "./engine.js";
import { seatWind, unseenFor, handCounts } from "./game.js";

/* Honors that score a fan as a pung for player p. */
export function isValueTile(state, p, k) {
  return isDragon(k) || k - 27 === seatWind(state, p) || k - 27 === state.prevailing;
}

/* Opponents who look close to winning: three or more sets shown. */
export function threats(state, p) {
  const out = [];
  state.players.forEach((pl, q) => { if (q !== p && pl.melds.filter((m) => !m.concealed).length >= 3) out.push(q); });
  return out;
}

/* How risky it is to discard kind k against threatening players (0 = safe). */
export function danger(state, p, k, threatList = threats(state, p)) {
  if (!threatList.length) return 0;
  const unseen = unseenFor(state, p);
  let d = 0;
  for (const q of threatList) {
    const safe = state.players[q].discards.some((x) => kindOf(x.id) === k);
    if (safe) continue;
    if (isHonor(k)) d += unseen[k] <= 1 ? 0.5 : 2;
    else {
      const n = k % 9;
      d += n === 0 || n === 8 ? 3 : n === 1 || n === 7 ? 4 : 5;
    }
  }
  return d;
}

/* Could this hand still score a fan if it is open (no concealed-hand fan)? */
export function hasFanPath(state, p, { extraMeldKind = null, removeKinds = [] } = {}) {
  const pl = state.players[p];
  if (!pl.flowers.length) return true; // "No flowers" is a fan
  if (pl.flowers.some((f) => (kindOf(f) - 34) % 4 === seatWind(state, p))) return true;
  const meldKinds = pl.melds.map((m) => ({ type: m.type, k: m.k }));
  if (extraMeldKind !== null) meldKinds.push({ type: "pung", k: extraMeldKind });
  if (meldKinds.some((m) => m.type !== "chow" && isValueTile(state, p, m.k))) return true;
  const c = handCounts(pl);
  removeKinds.forEach((k) => c[k]--);
  if (c.some((n, k) => n >= 2 && k >= 27 && isValueTile(state, p, k))) return true;
  // one suit (plus honors) within reach
  const all = [...c.flatMap((n, k) => Array(Math.max(0, n)).fill(k)), ...meldKinds.flatMap((m) => [m.k, m.k, m.k])];
  for (let s = 0; s < 3; s++) {
    const off = all.filter((k) => isSuited(k) && suitOf(k) !== s).length;
    if (off <= 2 && meldKinds.every((m) => !isSuited(m.k) || suitOf(m.k) === s)) return true;
  }
  return false;
}

/* Rank discards for p's current 14-tile shape: speed first (shanten, then tiles that help),
   tempered by keeping value pairs and by safety when someone looks ready. */
export function rankDiscards(state, p) {
  const pl = state.players[p];
  const c = handCounts(pl);
  const open = pl.melds.length;
  const unseen = unseenFor(state, p);
  const res = analyzeDiscards(c, open, unseen);
  const th = threats(state, p);
  for (const r of res) {
    let score = -r.shanten * 100 + r.ukeire;
    if (isHonor(r.k) && isValueTile(state, p, r.k) && c[r.k] >= 2) score -= 8;
    r.danger = danger(state, p, r.k, th);
    if (th.length && r.shanten >= 1) score -= r.danger * (r.shanten >= 2 ? 6 : 2.5);
    r.score = score;
  }
  res.sort((a, b) => b.score - a.score);
  return { list: res, threats: th, counts: c, open, unseen };
}

/* What a claim would do: shanten / tile acceptance after making the set and discarding best. */
export function evaluateClaims(state, q, opts) {
  const pl = state.players[q];
  const k = kindOf(state.lastDiscard.id);
  const c = handCounts(pl);
  const open = pl.melds.length;
  const unseen = unseenFor(state, q);
  const base = acceptance(c.slice(), open, unseen);
  const closed = pl.melds.every((m) => m.concealed);
  const out = { k, base, closed, choices: [] };

  const after = (remove, extraOpen) => {
    const cc = c.slice();
    remove.forEach((x) => cc[x]--);
    if (extraOpen === "kong") return { ...acceptance(cc, open + 1, unseen), discard: null };
    const best = analyzeDiscards(cc, open + 1, unseen)[0];
    return { shanten: best.shanten, count: best.ukeire, tiles: best.tiles, discard: best.k };
  };
  if (opts.win) out.choices.push({ type: "win", fan: opts.win.fan });
  if (opts.pung) out.choices.push({ type: "pung", ...after([k, k]), value: isValueTile(state, q, k), fanPath: hasFanPath(state, q, { extraMeldKind: k, removeKinds: [k, k] }) });
  if (opts.kong) out.choices.push({ type: "kong", ...after([k, k, k], "kong"), value: isValueTile(state, q, k), fanPath: hasFanPath(state, q, { extraMeldKind: k, removeKinds: [k, k, k] }) });
  for (const ch of opts.chows) out.choices.push({ type: "chow", chow: ch, ...after(ch), value: false, fanPath: hasFanPath(state, q, { removeKinds: ch }) });
  return out;
}

/* The recommended response to a claim opportunity, with a strength:
   "strong" = clearly right, "mild" = a judgement call. */
export function recommendClaim(state, q, opts) {
  const ev = evaluateClaims(state, q, opts);
  const win = ev.choices.find((x) => x.type === "win");
  if (win) return { pick: win, strength: "strong", ev, reason: "win" };
  const s0 = ev.base.shanten;
  let best = null;
  for (const ch of ev.choices) {
    let ok = false, strength = "mild", reason = "";
    if (ch.value && ch.type !== "chow" && ch.shanten <= s0) { ok = true; strength = "strong"; reason = "value"; }
    else if (ch.shanten < s0 && ch.fanPath && (!ev.closed || ch.shanten <= 0)) {
      ok = true; strength = ch.shanten <= 0 ? "strong" : "mild"; reason = ch.shanten <= 0 ? "ready" : "progress";
    }
    if (ok && (!best || ch.shanten < best.pick.shanten || (ch.shanten === best.pick.shanten && ch.count > best.pick.count))) {
      best = { pick: ch, strength, ev, reason };
    }
  }
  if (best) return best;
  // passing is better; how sure are we?
  const anyProgress = ev.choices.some((ch) => ch.shanten < s0);
  return { pick: { type: "pass" }, strength: anyProgress ? "mild" : "strong", ev, reason: anyProgress ? "keep-closed" : "no-progress" };
}

/* ---------------- Bots ---------------- */

export function botAct(state, p, opts) {
  if (opts.tsumo && opts.tsumo.legal) return { type: "tsumo" };
  const pl = state.players[p];
  if (opts.kongs.length) {
    const c = handCounts(pl);
    const s0 = analyzeDiscards(c.slice(), pl.melds.length, unseenFor(state, p))[0].shanten;
    for (const kg of opts.kongs) {
      const cc = c.slice();
      cc[kg.k] -= kg.type === "concealed" ? 4 : 1;
      const s1 = shanten(cc, pl.melds.length + (kg.type === "concealed" ? 1 : 0));
      if (s1 <= s0) return { type: "kong", k: kg.k, kongType: kg.type };
    }
  }
  const { list } = rankDiscards(state, p);
  const k = list[0].k;
  const id = pl.hand.filter((x) => kindOf(x) === k).pop();
  return { type: "discard", id };
}

export function botClaim(state, q, opts) {
  const rec = recommendClaim(state, q, opts);
  const pick = rec.pick;
  if (pick.type === "win") return { type: "win" };
  if (pick.type === "pass") return { type: "pass" };
  // bots are a little more conservative than the coach about opening up early
  if (rec.strength === "mild" && pick.type === "chow" && rec.ev.closed) return { type: "pass" };
  return pick.type === "chow" ? { type: "chow", chow: pick.chow } : { type: pick.type };
}

export { countsOf };
