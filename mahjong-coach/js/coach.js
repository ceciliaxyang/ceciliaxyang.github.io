// The coach: compares each of your decisions with the best move it can find and, when yours
// was clearly worse, writes a note explaining why. Notes are plain objects rendered by ui.js.
// Voice: written for a first-time player. Short, plain sentences, one idea each ("You need two more X to
// claim a peng."). No jargon without saying what it means ("points", not "fan"; "tiles away from winning").
import { kindOf, isHonor, isTerminal, isSuited, suitOf, numOf, isDragon, FAN_GUIDE } from "./engine.js";
import { tileHtml, tileName } from "./tiles.js";
import { actOptions, unseenFor, handCounts, seatWind } from "./game.js";
import { rankDiscards, recommendClaim, isValueTile } from "./strategy.js";

/* Internally a three-of-a-kind call is "pung"; on screen it is spelled "peng". */
const callName = (type) => (type === "pung" ? "peng" : type);

const t = (k, size = "xs") => tileHtml(k, { size, title: true });
const WIND_EN = ["East", "South", "West", "North"];

/* How far a hand is from winning, in plain words: the number of good tiles you still need to draw. */
function away(s) {
  if (s < 0) return "a winning hand";
  if (s === 0) return "1 tile away from winning";
  return `${s + 1} tiles away from winning`;
}
const awayShort = (s) => (s < 0 ? "Winning hand" : `${s + 1} away`);
const helps = (n) => `${n} useful tile${n === 1 ? "" : "s"} left`;

function tileStrip(kinds, unseen) {
  if (!kinds.length) return "";
  return `<div class="strip">${kinds.map((k) => `<span class="strip-item">${t(k)}<small>×${unseen[k]}</small></span>`).join("")}</div>`;
}

/* What job a tile was doing in hand c (14-tile shape including it). */
function roleOf(k, c, unseen) {
  const n = c[k];
  if (n >= 3) return { kind: "set", text: "already part of a group of three" };
  if (n === 2) {
    const dead = unseen[k] === 0;  // both other copies are already discarded or called
    if (isHonor(k)) return { kind: "pair", text: dead ? "a pair that can't become three (the others are gone)" : "a pair that could become three of a kind" };
    return { kind: "pair", text: `a pair, and every winning hand needs one${dead ? " (the others are gone)" : ""}` };
  }
  if (isHonor(k)) {
    const left = unseen[k];
    return {
      kind: "lone-honor",
      text: `a single ${isDragon(k) ? "dragon" : "wind"}. It can't be part of a run${left === 0 ? ", and no copies are left" : ""}`,
    };
  }
  const run = runWith(k, c);
  if (run) return { kind: "seq", text: `part of your ${run.seq} run` };
  const near = [];
  for (const d of [-2, -1, 1, 2]) {
    const x = k + d;
    if (x >= 0 && x < 27 && suitOf(x) === suitOf(k) && c[x]) near.push(x);
  }
  if (!near.length) {
    if (isTerminal(k)) return { kind: "lone-terminal", text: `a lone ${numOf(k)}. It fits only one run (${numOf(k) === 1 ? "1-2-3" : "7-8-9"})` };
    return { kind: "lone", text: "on its own, with nothing nearby" };
  }
  const adj = near.filter((x) => Math.abs(x - k) === 1);
  if (adj.length >= 2) return { kind: "seq", text: `the middle of a run (${near.map((x) => numOf(x)).join(" and ")} on each side)` };
  // what the partial sequence is waiting for, counting only copies that aren't already discarded or called
  const x = near[0], lo = Math.min(k, x), hi = Math.max(k, x);
  const waits = (hi - lo === 2 ? [lo + 1] : [lo - 1, hi + 1]).filter((w) => w >= 0 && w < 27 && suitOf(w) === suitOf(k));
  const left = waits.reduce((n, w) => n + unseen[w], 0);
  const gone = waits.length * 4 - left - waits.reduce((n, w) => n + (c[w] || 0), 0);
  const deadNote = left === 0 ? ", but those are all gone"
    : left <= 2 && gone > 0 ? `, and only ${left} ${left === 1 ? "is" : "are"} left` : "";
  return { kind: "shape", dead: left === 0, text: `next to your ${near.map((x) => numOf(x)).join(" and ")}. It needs a ${waits.map((w) => numOf(w)).join(" or ")} to make a run${deadNote}` };
}

/* A finished run in hand c that uses tile k (k-2..k, k-1..k+1 or k..k+2), or null. */
function runWith(k, c) {
  if (!isSuited(k)) return null;
  const s = suitOf(k), has = (x) => x >= 0 && x < 27 && suitOf(x) === s && c[x] > 0;
  for (const lo of [k - 2, k - 1, k]) {
    if (has(lo) && has(lo + 1) && has(lo + 2)) return { lo, seq: [lo, lo + 1, lo + 2].map(numOf).join("-") };
  }
  return null;
}

/* Why a tile is fine to throw away. For most tiles this is just its job (a lone wind, a lone 1...), but for a
   tile in a pair or a group the job ("a pair, and every hand needs one") would read as a reason to keep it,
   so those say why this copy is spare instead. */
function throwReason(k, c, unseen) {
  const n = c[k];
  if (n >= 2 && isSuited(k)) {
    // one copy is part of a run around it: the other is the spare
    const s = suitOf(k), ok = (x) => x >= 0 && x < 27 && suitOf(x) === s && c[x] > 0;
    const runs = [[k - 2, k - 1], [k - 1, k + 1], [k + 1, k + 2]].filter(([a, b]) => ok(a) && ok(b));
    if (runs.length) {
      const [a, b] = runs[0], seq = [a, b, k].sort((x, y) => x - y).map(numOf).join("-");
      return { kind: "spare", text: `a spare: your ${seq} run only needs one ${numOf(k)}` };
    }
  }
  // the end of a finished run: say what the two tiles left behind still need
  const run = n === 1 && runWith(k, c);
  if (run && k !== run.lo + 1) {
    const rest = [run.lo, run.lo + 1, run.lo + 2].filter((x) => x !== k);
    const cc = c.slice(); cc[k]--;
    const still = runWith(rest[0], cc) || runWith(rest[1], cc);
    if (still) return { kind: "spare", text: `a spare: your ${still.seq} run doesn't need it` };
    const s = suitOf(k);
    const waits = [rest[0] - 1, rest[1] + 1].filter((w) => w >= 0 && w < 27 && suitOf(w) === s && unseen[w] > 0);
    const restTxt = rest.map(numOf).join(" and ");
    return {
      kind: "run-end",
      text: `the end of your ${run.seq} run. Without it, your ${restTxt} can still make a run${waits.length ? ` with a ${waits.map(numOf).join(" or ")}` : ""}, and your other tiles get more chances`,
    };
  }
  if (n === 4) return { kind: "spare", text: "your fourth copy, and a group of three only needs three" };
  if (n === 3) return { kind: "spare", text: "a spare copy: throwing one still leaves you a pair of them" };
  if (n === 2) {
    const pairs = c.filter((x) => x === 2).length;
    if (pairs > 1) return { kind: "spare", text: `one of your ${pairs} pairs, and a winning hand only needs one` };
    return { kind: "spare", text: "a pair, but your other tiles are closer to making groups, and a new pair is easy to find later" };
  }
  return roleOf(k, c, unseen);
}

/* The coach's pick for your discard, shared by "Here's what I'd do" and the notes so they never disagree.
   Among the moves that leave you just as close to winning as the best one:
   - keep your only pair and any finished group of three, if another tile is just as close (a beginner habit
     that matters more than a few extra useful tiles);
   - then, within a couple of useful tiles of the top move, prefer lone winds and dragons, then lone 1s and 9s. */
function coachPick(state) {
  const ranked = rankDiscards(state, 0);
  const c = ranked.counts;
  const pairCount = c.filter((n) => n >= 2).length;
  const habit = (r) => (c[r.k] >= 3 || (c[r.k] === 2 && pairCount === 1) ? 3 : r.tier);
  const top0 = ranked.list[0];
  const sameDist = ranked.list.filter((r) => r.shanten === top0.shanten);
  const keepers = sameDist.filter((r) => habit(r) !== 3);
  const pool = keepers.length ? keepers : sameDist;   // already in score order
  const lead = pool[0];
  const tol = Math.max(2, Math.round(lead.ukeire * 0.1));
  const near = pool.filter((r) => r.score >= lead.score - tol).sort((a, b) => habit(a) - habit(b) || b.score - a.score);
  return { ranked, c, habit, top0, near, best: near[0] };
}

let noteSeq = 0;
function note(state, fields) {
  return { id: ++noteSeq, handNo: state.handNo, time: Date.now(), ...fields };
}

/* ---------- Your turn: discard / win / kong ---------- */

export function reviewAct(before, action) {
  const opts = actOptions(before, 0);
  // missed self-drawn win
  if (opts.tsumo && opts.tsumo.legal && action.type !== "tsumo") {
    return missedWinNote(before, opts.tsumo, true);
  }
  if (action.type !== "discard") return null;
  const pick = coachPick(before);
  const ranked = pick.ranked;
  const k = kindOf(action.id);
  const mine = ranked.list.find((r) => r.k === k);
  const best = pick.best;
  if (!mine || best.k === k) return null;
  // anything the coach would also have been happy with (her near-tie choices) isn't worth a note
  if (pick.near.some((r) => r.k === k)) return null;
  const worseShape = mine.shanten > best.shanten;
  const fewer = mine.shanten === best.shanten && best.ukeire - mine.ukeire >= Math.max(4, best.ukeire * 0.25);
  // if you threw a safe tile while someone looked ready, that's defence, not a mistake
  const defending = ranked.threats.length && mine.danger === 0 && best.danger > 0;
  const unsafe = ranked.threats.length && mine.danger >= 4 && best.danger === 0 && mine.shanten >= 1;
  if (defending && !worseShape) return null;
  if (!worseShape && !fewer && !unsafe) return null;

  const c = ranked.counts;
  const unseen = ranked.unseen;
  const roleBest = throwReason(best.k, c, unseen);
  const roleMine = roleOf(k, c, unseen);
  const p = [];
  if (unsafe && !worseShape && !fewer) {
    const q = ranked.threats.map((x) => before.players[x].name).join(" and ");
    p.push(`<p>${q} ${ranked.threats.length > 1 ? "have" : "has"} three groups showing, so ${ranked.threats.length > 1 ? "they" : "they"} may be close to winning. You're still ${away(mine.shanten)}.</p>`);
    p.push(`<p>If you throw the tile they need, they win. ${t(best.k)} was safer: ${best.danger === 0 ? "they already threw one away, so it can't win for them" : "it's less likely to be what they need"}. ${t(k)} ${mine.danger >= 5 ? "is a middle number, and those are often what people need" : "could be what they need"}.</p>`);
    p.push(`<p class="tip">Tip: when someone looks close to winning, throw tiles they've already thrown.</p>`);
    return note(before, {
      kind: "defense",
      title: `${tileName(best.k)} was the safer tile to throw away`,
      bubble: `Careful: ${before.players[ranked.threats[0]].name} may be close to winning.`,
      compare: { mine: { k, label: "You threw" }, best: { k: best.k, label: "Safer" } },
      html: p.join(""),
    });
  }
  // the two boxes above already say how close each throw leaves you, so the text starts with why
  p.push(`<p><b>Why:</b> ${t(best.k)} is ${roleBest.text}. Your ${t(k)} was ${roleMine.text}.</p>`);
  // a short list of the tiles you'd hope for is useful; early in a hand it's a wall of tiles, so leave it out
  if (best.tiles.length <= 8) p.push(`<p>Throwing ${t(best.k)}, you'd hope to pick up one of these (the number is how many are left):</p>${tileStrip(best.tiles, unseen)}`);
  p.push(`<p class="tip">${tipFor(roleBest, roleMine, before)}</p>`);
  return note(before, {
    kind: "discard",
    title: `${tileName(best.k)} was the better tile to throw away`,
    bubble: worseShape ? `That moved you further from winning.` : `There was a better tile to throw.`,
    compare: worseShape
      ? { mine: { k, label: "You threw", sub: awayShort(mine.shanten) }, best: { k: best.k, label: "Better", sub: awayShort(best.shanten) } }
      : { mine: { k, label: "You threw", sub: helps(mine.ukeire) }, best: { k: best.k, label: "Better", sub: helps(best.ukeire) } },
    html: p.join(""),
  });
}

function tipFor(roleBest, roleMine, state) {
  if (roleBest.kind === "lone-honor") return "Tip: throw single winds and dragons early. They can't make runs.";
  if (roleBest.kind === "lone-terminal") return "Tip: 1s and 9s are hard to use. Middle numbers (3 to 7) fit more runs.";
  if (roleMine.kind === "shape" && roleMine.dead) return "Tip: a pair of tiles waiting for a number that's all gone can't make a run. Those are good to throw.";
  if (roleMine.kind === "seq" || roleMine.kind === "shape") return "Tip: keep tiles that sit next to each other, like 4 and 5.";
  if (roleMine.kind === "pair") return "Tip: a winning hand is four groups of three plus one pair. Keep a pair.";
  return "Tip: a winning hand is four groups of three plus one pair. Throw the tile that helps least.";
}

function missedWinNote(state, win, selfDraw) {
  const arr = win.arrangement;
  if (state.points === false) {
    // playing without points: just the winning shape, no scoring
    return note(state, {
      kind: "win",
      title: "You had a winning hand",
      bubble: "Wait, you could have won there!",
      html: [
        `<p>Your hand was complete. ${selfDraw ? "You could have won with the tile you picked up." : "You could have won with that thrown tile."}</p>`,
        arr && !arr.special ? `<p>Your four groups and a pair:</p>${arrangementHtml(state, arr, selfDraw)}` : "",
        `<p class="tip">Tip: check the Win button before you throw a tile.</p>`,
      ].join(""),
    });
  }
  // each scoring line with a one-line plain explanation (from the scoring guide) under its name
  const why = (n) => (FAN_GUIDE.find(([g]) => g === n || (n.endsWith("dragon peng") && g === "Dragon peng")) || [])[2];
  const items = win.items.map(([n, f]) => `<li><span>${n}${why(n) ? `<small>${why(n)}</small>` : ""}</span><span>${f} pt${f === 1 ? "" : "s"}</span></li>`).join("");
  const html = [
    `<p>Your hand could win. It was worth <b>${win.fan} point${win.fan === 1 ? "" : "s"}</b> (points are called <i>fan</i>). ${selfDraw ? "You could have won with the tile you picked up." : "You could have won with that thrown tile."}</p>`,
    arr && !arr.special ? `<p>Your four groups and a pair:</p>${arrangementHtml(state, arr, selfDraw)}` : "",
    `<p>Your points:</p><ul class="fan-list">${items}</ul>`,
    `<p class="tip">Tip: the Win button lights up when your hand can win. Check it before you throw a tile.</p>`,
  ].join("");
  return note(state, {
    kind: "win",
    title: "You had a winning hand",
    bubble: "Wait, you could have won there!",
    html,
  });
}

function arrangementHtml(state, arr, selfDraw) {
  const pl = state.players[0];
  const groups = pl.melds.map((m) => m.tiles.map((id) => kindOf(id)));
  for (const s of arr.sets) groups.push(s.type === "pung" ? [s.k, s.k, s.k] : [s.k, s.k + 1, s.k + 2]);
  groups.push([arr.pair, arr.pair]);
  return `<div class="groups">${groups.map((g) => `<span class="group">${g.map((k) => t(k)).join("")}</span>`).join("")}</div>`;
}

/* ---------- A discard you could have claimed ---------- */

export function reviewClaim(before, resp) {
  const opts = before.claim.options[0];
  if (!opts) return null;
  const rec = recommendClaim(before, 0, opts);
  const pick = rec.pick;
  const ev = rec.ev;
  const k = ev.k;
  const unseen = unseenFor(before, 0);
  const from = before.players[before.lastDiscard.from].name;

  if (pick.type === "win" && resp.type !== "win") return missedWinNote(before, opts.win, false);
  if (resp.type === "win") return null;
  const same = resp.type === pick.type && (resp.type !== "chow" || String(resp.chow) === String(pick.chow));
  if (same || rec.strength !== "strong") return null;

  // you passed, claiming was clearly better
  if (resp.type === "pass") {
    const p = [];
    const call = pick.type === "pung" ? "peng" : pick.type;
    if (rec.reason === "value") {
      p.push(`<p>This peng earns <b>1 point</b>${isDragon(k) ? ". Dragons always score" : `, because ${k - 27 === seatWind(before, 0) ? "it's your wind" : "it's this round's wind"}`}. You need points to win.</p>`);
      p.push(`<p>Taking it ${pick.shanten < ev.base.shanten ? `would also have moved you to <b>${away(pick.shanten)}</b>` : `would have kept you ${away(pick.shanten)}`}.</p>`);
      p.push(`<p class="tip">Tip: if you have two dragons, or two of your wind, take the third.</p>`);
    } else {
      p.push(`<p>This ${call} would have left you <b>${away(pick.shanten)}</b>. Without it you stayed ${away(ev.base.shanten)}.</p>`);
      if (pick.shanten <= 0) p.push(`<p>Then any of these would win (the number is how many are left):</p>${tileStrip(pick.tiles, unseen)}`);
      p.push(`<p class="tip">Tip: if taking a tile gets you 1 away from winning, take it.</p>`);
    }
    return note(before, {
      kind: "claim",
      title: `Taking ${from}'s ${tileName(k)} would have helped`,
      bubble: `Taking that ${tileName(k)} would have helped.`,
      // the green box: the call you could have made, as a set
      set: { label: `You should have claimed a ${call}`, k, tiles: callSet(pick, k) },
      html: p.join(""),
    });
  }

  // you claimed, passing was clearly better
  if (pick.type === "pass") {
    const mine = ev.choices.find((ch) => ch.type === resp.type && (resp.type !== "chow" || String(ch.chow) === String(resp.chow)));
    if (!mine) return null;
    const p = [];
    p.push(`<p>Taking ${resp.type === "chow" ? chowTiles(resp.chow, k) : t(k)} left you <b>${away(mine.shanten)}</b>. ${mine.shanten > ev.base.shanten ? `Before, you were ${away(ev.base.shanten)}.` : `That's no closer than before.`}</p>`);
    if (ev.closed && before.points !== false) p.push(`<p>It also showed your tiles to everyone, and you lost the <b>1 point</b> for never taking a tile.</p>`);
    if (!mine.fanPath && before.points !== false) p.push(`<p>Nothing in your hand earns points yet, so winning is now harder.</p>`);
    p.push(before.points === false
      ? `<p class="tip">Tip: only take a tile if it gets you closer to winning.</p>`
      : `<p class="tip">Tip: only take a tile if it gets you closer to winning, or if it's a dragon or your own wind.</p>`);
    return note(before, {
      kind: "claim",
      title: `Letting that ${tileName(k)} go was better`,
      bubble: `Taking that tile didn't help.`,
      html: p.join(""),
    });
  }
  return null;
}

/* A call's whole set for the green box: your own tiles (marked mine, drawn see-through) and the thrown-away one,
   a run in number order. */
function callSet(pick, k) {
  const mine = pick.type === "chow" ? pick.chow : pick.type === "kong" ? [k, k, k] : [k, k];
  const set = [...mine.map((x) => ({ k: x, mine: true })), { k, mine: false }];
  return pick.type === "chow" ? set.sort((a, b) => a.k - b.k) : set;
}

function chowTiles(ch, k) {
  return [...ch, k].sort((a, b) => a - b).map((x) => t(x)).join("");
}

/* ---------- On-demand hint ---------- */

/* Why you can't take someone's thrown-away tile, in one short sentence under the "Let it go" box. */
function whyCantClaim(state, k) {
  // said plainly: you can't claim it. The one case with more to it is a run you could have made, had the tile
  // come from the player before you
  const c = handCounts(state.players[0]);
  const from = state.lastDiscard.from;
  const left = state.players[3].name;
  const run = isSuited(k) && [[-2, -1], [-1, 1], [1, 2]].some(([a, b]) => {
    const x = k + a, y = k + b;
    return x >= 0 && y < 27 && suitOf(x) === suitOf(k) && suitOf(y) === suitOf(k) && c[x] && c[y];
  });
  if (run && from !== 3) return `You could make a run with it, but runs only take tiles from ${left}, the player before you. Press Continue.`;
  return "You can't claim it: you don't have the tiles to make a set with it. Press Continue.";
}

export function hint(state) {
  if (state.phase === "act" && state.current === 0) {
    const opts = actOptions(state, 0);
    // no green box here: the card's own red Mahjong button (at the bottom, like the one in the white box) wins
    if (opts.tsumo && opts.tsumo.legal) return { title: "You can win", win: true, html: state.points === false ? `<p>Your hand is complete. Tap <b>Mahjong</b> to win.</p>` : `<p>Your hand is complete, and it's worth <b>${opts.tsumo.fan} point${opts.tsumo.fan === 1 ? "" : "s"}</b>. Tap <b>Mahjong</b> to win.</p>` };
    const { ranked, c, habit, top0, near, best } = coachPick(state);
    const top = [best, ...ranked.list.filter((r) => r !== best)].slice(0, 3);
    const role = throwReason(best.k, ranked.counts, ranked.unseen);
    const rows = top.map((r) => `<li>${t(r.k)}<span>${awayShort(r.shanten)}</span><span>${helps(r.ukeire)}</span></li>`).join("");
    // single winds or dragons the coach is keeping because they can earn points: say so, since beginners expect
    // lone honors to go first
    const kept = ranked.list.filter((r) => r.k !== best.k && isHonor(r.k) && ranked.counts[r.k] === 1 && isValueTile(state, 0, r.k)).map((r) => r.k);
    const pts = (k) => (!isDragon(k) && k - 27 === seatWind(state, 0) && k - 27 === state.prevailing ? 2 : 1);
    const keptHtml = kept.length && !isHonor(best.k)
      ? `<p><b>Why not ${kept.map((k) => t(k)).join(" or ")}?</b> ${kept.map((k) => `Three ${t(k)} earn ${pts(k)} point${pts(k) > 1 ? "s" : ""}.`).join(" ")} You need points to win, so keep ${kept.length > 1 ? "them" : "it"} for now.</p>`
      : "";
    // moves exactly as good as the best one all go in the card; the tie-breaker decides which is named first
    const equal = near.filter((r) => habit(r) === habit(best) && r.score === best.score).map((r) => r.k);
    // a tie: no favourite. If the tiles are doing the same job (two single winds, say), one reason covers them all;
    // otherwise each gets its own
    const roles = equal.map((k) => ({ k, text: throwReason(k, ranked.counts, ranked.unseen).text }));
    const either = equal.length === 2 ? "either one" : "any of them";
    const lead = equal.length < 2
      ? `<p>It's ${role.text}.</p>`
      : roles.every((r) => r.text === roles[0].text)
        ? `<p>These are equally good. Each one is ${roles[0].text}. Throw ${either}.</p>`
        : `<p>These are equally good, so throw ${either}.</p><ul class="why-list">${roles.map((r) => `<li>${t(r.k)} is ${r.text}.</li>`).join("")}</ul>`;
    // the numbers slightly favoured breaking your only pair: say why the coach didn't
    const pairNote = top0 !== best && habit(top0) === 3
      ? (c[top0.k] >= 3
        ? `<p><b>Why not ${t(top0.k)}?</b> On paper it keeps a few more tiles in play, but you have three of them, a finished group. Keep it.</p>`
        : `<p><b>Why not ${t(top0.k)}?</b> On paper it keeps a few more tiles in play, but it's your only pair. Every winning hand needs one, so keep it.</p>`)
      : "";
    let html = `${lead}${pairNote}${keptHtml}`
      + `<p>Your top choices (how far from winning, and how many useful tiles are left):</p><ul class="hint-list">${rows}</ul>`;
    if (ranked.threats.length) html += `<p class="tip">Heads up: ${ranked.threats.map((q) => state.players[q].name).join(" and ")} may be close to winning. Tiles they threw away are safe.</p>`;
    if (opts.kongs.length) html += `<p class="tip">You have four ${opts.kongs.map((x) => t(x.k)).join("")}. Set them down as a <i>kong</i> to get an extra tile.</p>`;
    return { title: "Here's what I'd do", pick: { k: best.k, ks: equal, label: equal.length > 1 ? "Throw one away" : "Throw away" }, html };
  }
  if (state.phase === "claim" && state.claim?.options[0] && !state.claim.responses[0]) {
    if (state.claim.options[0].none) {
      const k = kindOf(state.lastDiscard.id);
      return { title: "Here's what I'd do", pick: { k, label: "Let it go" }, html: `<p>${whyCantClaim(state, k)}</p>` };
    }
    const rec = recommendClaim(state, 0, state.claim.options[0]);
    const pick = rec.pick;
    const k = rec.ev.k;
    if (pick.type === "win") return { title: "Here's what I'd do", pick: { k, label: "Take it and win" }, html: `<p>This finishes your hand.</p>` };
    if (pick.type === "pass") {
      return { title: "Here's what I'd do", pick: { k, label: "Let it go" }, html: `<p>Taking it won't get you closer. You'd still be ${away(rec.ev.base.shanten)}.${rec.ev.closed && state.points !== false ? " Never taking a tile also earns 1 point." : ""}</p>` };
    }
    // the card names the call and shows the whole set: your own tiles (drawn a little see-through) and the thrown-away one
    const set = callSet(pick, k);
    // the green box already shows the set, so the sentence just names the call
    const call = pick.type === "pung" ? "peng" : pick.type;
    return { title: "Here's what I'd do", pick: { k, label: `Claim a ${call}`, set },
      html: `<p>This ${call} would get you to ${away(pick.shanten)}.${rec.reason === "value" ? " It also earns a point." : ""}</p>` };
  }
  return { title: "Waiting", html: `<p>It's not your turn yet. I'll speak up if I spot something.</p>` };
}

export { isValueTile, handCounts, isSuited, WIND_EN };
