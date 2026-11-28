// The coach: compares each of your decisions with the best move it can find and, when yours
// was clearly worse, writes a note explaining why. Notes are plain objects rendered by ui.js.
// Voice: written for a first-time player. Short, plain sentences, one idea each ("You need two more X to
// claim a peng."). No jargon without saying what it means ("points", not "fan"; "2 more tiles to win").
import { kindOf, shanten, closestShape, shapeGroups, ORPHANS, isHonor, isTerminal, isSuited, suitOf, numOf, isDragon, FAN_GUIDE } from "./engine.js";
import { tileHtml, tileName } from "./tiles.js";
import { actOptions, unseenFor, handCounts, seatWind } from "./game.js";
import { rankDiscards, recommendClaim, isValueTile } from "./strategy.js";

/* Internally a three-of-a-kind call is "pung"; on screen it is spelled "peng". */
const callName = (type) => (type === "pung" ? "peng" : type);

const t = (k, size = "xs") => tileHtml(k, { size, title: true });
const WIND_EN = ["East", "South", "West", "North"];

/* How far a hand is from winning, in plain words: the fewest good tiles you still need to pick up.
   toWin reads on its own ("2 more tiles to win"); `needing` fits after "you need" / "left you needing". */
const moreTiles = (s) => `${s + 1} more tile${s === 0 ? "" : "s"}`;
const toWin = (s) => (s < 0 ? "Winning hand" : `${moreTiles(s)} to win`);
const needing = (s) => (s < 0 ? "nothing more: it's a winning hand" : `${moreTiles(s)} to win`);
const helps = (n) => `${n} useful tile${n === 1 ? "" : "s"} left`;

function tileStrip(kinds, unseen) {
  if (!kinds.length) return "";
  return `<div class="strip">${kinds.map((k) => `<span class="strip-item">${t(k)}<small>${unseen[k]} left</small></span>`).join("")}</div>`;
}

/* Where every copy of a tile went, in words, for "those are all gone": e.g. "Player 3 has all four in a kong",
   "two were thrown away and Player 1 has a peng of them". `skipMine`: leave out the copies in your own hand
   (when the sentence already counts them, as for your pair). */
const NUM = ["no", "one", "two", "three", "all four"];
function goneWhere(state) {
  return (k, skipMine = false) => {
    const parts = [];
    const mine = state.players[0].hand.filter((id) => kindOf(id) === k).length
      + state.players[0].melds.reduce((n, m) => n + m.tiles.filter((id) => kindOf(id) === k).length, 0);
    if (mine && !skipMine) parts.push({ n: mine, text: (w) => `you have ${w}` });
    state.players.forEach((pl, q) => {
      if (q === 0) return;
      for (const m of pl.melds) {
        const n = m.tiles.filter((id) => kindOf(id) === k).length;
        if (!n) continue;
        const what = m.type === "kong" ? (m.concealed ? "a hidden kong" : "a kong") : m.type === "pung" ? "a peng" : "a run";
        parts.push({ n, text: (w) => `${pl.name} has ${w} in ${what}` });
      }
    });
    const thrown = state.players.reduce((n, pl) => n + pl.discards.filter((d) => !d.taken && kindOf(d.id) === k).length, 0);
    if (thrown) parts.push({ n: thrown, text: (w) => `${w} ${thrown === 1 ? "was" : "were"} thrown away` });
    if (!parts.length) return "";
    const say = parts.map((p) => p.text(parts.length === 1 && p.n === 4 ? "all four" : NUM[p.n]));
    return say.length === 1 ? say[0] : `${say.slice(0, -1).join(", ")} and ${say[say.length - 1]}`;
  };
}
const goneNote = (unseen, k, skipMine) => { const w = unseen.where && unseen.where(k, skipMine); return w ? `: ${w}` : ""; };

/* What job a tile was doing in hand c (14-tile shape including it). */
function roleOf(k, c, unseen) {
  const n = c[k];
  if (n >= 3) return { kind: "set", text: "already part of a group of three" };
  if (n === 2) {
    const dead = unseen[k] === 0;  // both other copies are already discarded or called
    const where = dead ? goneNote(unseen, k, true) : "";
    if (isHonor(k)) return { kind: "pair", text: dead ? `a pair that can't become three (the other two are gone${where})` : "a pair that could become three of a kind" };
    return { kind: "pair", text: `a pair, and every winning hand needs one${dead ? ` (the other two are gone${where})` : ""}` };
  }
  if (isHonor(k)) {
    const left = unseen[k];
    return {
      kind: "lone-honor",
      text: `a single ${isDragon(k) ? "dragon" : "wind"}. It can't be part of a run${left === 0 ? `, and no copies are left${goneNote(unseen, k, true)}` : ""}`,
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
  const deadNote = left === 0 ? `, but those are all gone${waits.length === 1 ? goneNote(unseen, waits[0]) : ""}`
    : left <= 2 && gone > 0 ? `, and only ${left} ${left === 1 ? "is" : "are"} left` : "";
  const runs = waits.map((w) => [w, lo, hi].sort((a, b) => a - b).map(numOf).join("-")).join(" or ");
  return { kind: "shape", dead: left === 0, text: `next to your ${near.map((x) => numOf(x)).join(" and ")}. It needs a ${waits.map((w) => numOf(w)).join(" or ")} to make a run${deadNote}`,
    lead: `It needs a ${waits.map((w) => numOf(w)).join(" or ")} to make a run (${runs})${deadNote}` };
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
  ranked.unseen.where = goneWhere(state);  // so "all gone" can say where they went
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

/* ---------- End of the hand: how you did ---------- */

/* How far your hand is from winning right now (shanten: 0 = 1 more tile to win), for the summary's "closest". */
export function distance(state) {
  const pl = state.players[0];
  return shanten(handCounts(pl), pl.melds.length, unseenFor(state, 0));
}

/* The footnote at the end of every coach card while a hand is on: how far your hand is from winning right now. */
export function awayNote(state) {
  const s = distance(state);
  if (s < 0) return "You have a winning hand.";
  const pl = state.players[0];
  const shape = closestShape(handCounts(pl), pl.melds.length, unseenFor(state, 0));
  const with_ = shape === "sevenPairs" ? " with seven pairs" : shape === "orphans" ? " with thirteen orphans" : "";
  return `You're ${s + 1} tile${s === 0 ? "" : "s"} away from winning${with_}.`;
}

/* The special hands, drawn the same way (only when Special hands is on). Seven pairs: the pairs you have, then a
   single and an empty tile for each pair still to make. Thirteen orphans: the 1s and 9s of each suit, the winds,
   the dragons, an empty tile for each one missing, your pair's second tile beside its first, or (no pair yet) one
   empty tile on its own for it. */
function sevenPairsShape(c, unseen, skip) {
  const groups = [], singles = [];
  for (let k = 0; k < 34; k++) {
    if (c[k] >= 2 && groups.length < 7) groups.push({ tiles: [k, k], done: true });
    else if (c[k] >= 1) singles.push(k);
  }
  singles.sort((a, b) => (a === skip) - (b === skip) || unseen[b] - unseen[a] || a - b);
  while (groups.length < 7) { const k = singles.shift(); groups.push({ tiles: k === undefined ? [null, null] : [k, null], done: false }); }
  return groups;
}
function orphansShape(c) {
  const pairK = ORPHANS.find((k) => c[k] >= 2);
  const groups = [[0, 8], [9, 17], [18, 26], [27, 28, 29, 30], [31, 32, 33]].map((ks) => ({
    tiles: ks.flatMap((k) => (c[k] >= 1 ? (k === pairK ? [k, k] : [k]) : [null])), done: false,
  }));
  if (pairK === undefined) groups.push({ tiles: [null], done: false });
  return groups;
}

/* The same hand as four sets and a pair (Figma 2466:40833): each group's tiles, null where a tile is still
   missing, and whether it's finished. Your called sets come first, then sets in your hand, then the unfinished
   ones, then the pair. The gaps add up to the footnote's count. Null when the hand is closest to a special shape
   (seven pairs, thirteen orphans), where four sets and a pair would be the wrong picture. `skip`: a tile kind to
   keep out of the unfinished groups if there's a choice (the one the coach says to throw away). */
export function awayShape(state, skip = null) {
  const pl = state.players[0];
  const c = handCounts(pl), unseen = unseenFor(state, 0), open = pl.melds.length;
  const s = distance(state);
  if (s < -1) return null;
  const shape = closestShape(c, open, unseen);
  if (shape === "sevenPairs") return sevenPairsShape(c, unseen, skip);
  if (shape === "orphans") return orphansShape(c);
  const g = shapeGroups(c, open, unseen);
  if (g.s !== s) return null;
  const singles = [];
  for (let k = 0; k < 34; k++) for (let i = 0; i < g.rest[k]; i++) singles.push(k);
  singles.sort((a, b) => (a === skip) - (b === skip));
  const groups = [
    ...pl.melds.map((m) => ({ tiles: m.tiles.map(kindOf).sort((a, b) => a - b), done: true })),
    ...g.sets.map((t) => ({ tiles: t, done: true })),
  ];
  for (const p of g.parts) { const t = p.tiles.slice(); t.splice(p.gap, 0, null); groups.push({ tiles: t, done: false }); }
  while (groups.length < 4) { const k = singles.shift(); groups.push({ tiles: k === undefined ? [null, null, null] : [k, null, null], done: false }); }
  if (g.pair !== null) groups.push({ tiles: [g.pair, g.pair], done: true });
  else { const k = singles.shift(); groups.push({ tiles: k === undefined ? [null, null] : [k, null], done: false }); }
  return groups;
}

/* The one thing to work on, by the kind of note the coach gave most this hand. */
const LESSON = {
  discard: "When choosing what to throw, keep tiles that sit next to each other and let go of lone winds, dragons, 1s and 9s first.",
  defense: "When someone shows three groups, throw tiles they've already thrown. Those can't win for them.",
  claim: "Take a thrown tile when it gets you closer to winning (or earns a point), and let it go when it doesn't.",
  win: "Check whether you can win before you throw a tile.",
};

/* The coach's last note of a hand. `moves`: your decisions this hand, each { type: "discard" | "claim", ok,
   away } (ok = the coach agreed; away = how far from winning it left you). `handNotes`: the coach's notes this
   hand. `tookBack`: how many moves you undid or took back. */
export function summaryNote(state, moves, handNotes, tookBack) {
  const r = state.result;
  const p = [];
  const won = r.type !== "draw" && r.winner === 0;
  // the score: decisions that matched what the coach would have done. Who won is on the table already, and how
  // close you got is in the footnote (ui.js), so the card opens with the score
  const good = moves.filter((m) => m.ok).length;
  const all = moves.length && good === moves.length;
  const congrats = won ? "Congratulations on your win! " : "";
  if (moves.length) {
    p.push(all
      ? `<p>${congrats}All ${won ? "of " : ""}your choices matched what I'd have done.${won ? "" : " Well played!"}</p>`
      : `<p>${congrats}<b>${good} of your ${moves.length} choice${moves.length === 1 ? "" : "s"}</b> matched what I would've done.</p>`);
    const rows = [];
    const row = (label, list) => { if (list.length) rows.push(`<li><span>${label}</span><span>${list.filter((m) => m.ok).length} of ${list.length}</span></li>`); };
    row("Tiles you threw", moves.filter((m) => m.type === "discard"));
    row("Taking or passing on tiles", moves.filter((m) => m.type === "claim"));
    const missed = handNotes.filter((n) => n.kind === "win").length;
    if (missed) rows.push(`<li><span>Missed wins</span><span>${missed}</span></li>`);
    if (tookBack) rows.push(`<li><span>Moves taken back</span><span>${tookBack}</span></li>`);
    p.push(`<ul class="fan-list">${rows.join("")}</ul>`);
  } else if (won) {
    p.push(`<p>Congratulations on your win!</p>`);
  }
  // one thing to work on (the kind of slip that came up most)
  const counts = {};
  handNotes.forEach((n) => { if (LESSON[n.kind]) counts[n.kind] = (counts[n.kind] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (top) p.push(`<p class="tip">Next time: ${LESSON[top]}</p>`);
  else if (!moves.length && !won) p.push(`<p>Nothing for me to review this hand.</p>`);
  const share = moves.length ? good / moves.length : 1;
  return note(state, {
    kind: "summary",
    title: "How you did this hand",
    bubble: won ? "Well played! Here's how your hand went." : share >= 0.8 ? "Nicely played. Here's how your hand went." : "Here's how your hand went.",
    html: p.join(""),
  });
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
    p.push(`<p>${q} ${ranked.threats.length > 1 ? "have" : "has"} three groups showing, so ${ranked.threats.length > 1 ? "they" : "they"} may be close to winning. You still need ${needing(mine.shanten)}.</p>`);
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
  // both tiles come from pairs: describing each one's job ("a pair") doesn't say which to break up, so compare
  const bothPairs = c[best.k] === 2 && c[k] === 2;
  const pairCount = c.filter((n) => n === 2).length;
  // both tiles on their own: "on its own" would read as a reason to throw either, so say what each could become
  const LONE = ["lone", "lone-terminal", "lone-honor"];
  const bothLone = !bothPairs && LONE.includes(roleBest.kind) && LONE.includes(roleMine.kind);
  if (bothPairs) {
    p.push(`<p><b>Why:</b> ${t(best.k)} and ${t(k)} are both pairs. You have ${pairCount} pairs and a winning hand only needs one, so one of them can go.</p>`);
    p.push(worseShape
      ? `<p>Breaking up your ${t(best.k)} is the better choice. It leaves you closer to winning: ${moreTiles(best.shanten)} to win, instead of ${moreTiles(mine.shanten)}.</p>`
      : `<p>Breaking up your ${t(best.k)} is the better choice. It leaves more tiles that can help you: ${best.ukeire} instead of ${mine.ukeire}.</p>`);
  } else if (bothLone) {
    p.push(`<p><b>Why:</b> ${loneWhy(best, mine, before)}</p>`);
  } else {
    p.push(`<p><b>Why:</b> ${t(best.k)} is ${roleBest.text}. Your ${t(k)} was ${roleMine.text}.</p>`);
  }
  // a short list of the tiles you'd hope for is useful; early in a hand it's a wall of tiles, so leave it out
  if (best.tiles.length <= 8) p.push(`<p>Throwing ${t(best.k)}, you'd hope to pick up one of these:</p>${tileStrip(best.tiles, unseen)}`);
  p.push(`<p class="tip">${bothPairs ? `Tip: you only need one pair. When you have extra, break up the one that ${worseShape ? "keeps you closest to winning" : "leaves you the most useful tiles"}.`
    : bothLone && roleBest.kind === "lone" && roleMine.kind === "lone" ? "Tip: when two tiles are both on their own, keep the one that fits more runs. Middle numbers (3 to 7) fit the most."
    : tipFor(roleBest, roleMine, before)}</p>`);
  return note(before, {
    kind: "discard",
    title: `${tileName(best.k)} was the better tile to throw away`,
    bubble: worseShape ? `That moved you further from winning.` : `There was a better tile to throw.`,
    compare: worseShape
      ? { mine: { k, label: "You threw", sub: toWin(mine.shanten) }, best: { k: best.k, label: "Better", sub: toWin(best.shanten) } }
      : { mine: { k, label: "You threw", sub: helps(mine.ukeire) }, best: { k: best.k, label: "Better", sub: helps(best.ukeire) } },
    html: p.join(""),
  });
}

/* The runs a single suited tile could still become part of, e.g. 2 → ["1-2-3", "2-3-4"]. */
function runsFor(k) {
  const n = numOf(k), out = [];
  for (let s = Math.max(1, n - 2); s <= Math.min(7, n); s++) out.push(`${s}-${s + 1}-${s + 2}`);
  return out;
}
const kindWord = (k) => (isDragon(k) ? "dragon" : "wind");

/* Why one lone tile is a better throw than another lone tile: what each could still grow into. */
function loneWhy(best, mine, state) {
  const b = best.k, m = mine.k;
  const lead = `${t(b)} and ${t(m)} are both on their own, so either could go.`;
  // a hand heading for a special hand wants different tiles: say so
  const pl = state.players[0];
  const shape = closestShape(handCounts(pl), pl.melds.length, unseenFor(state, 0));
  if (shape === "orphans" && ORPHANS.includes(m) && !ORPHANS.includes(b))
    return `${lead} But your hand is closest to <b>Thirteen orphans</b> (one of every 1, 9, wind and dragon), so your ${t(m)} is one of the tiles it needs and ${t(b)} isn't.`;
  if (mine.shanten > best.shanten)
    return `${lead} But throwing ${t(b)} leaves you closer to winning: ${moreTiles(best.shanten)} to win, instead of ${moreTiles(mine.shanten)}.`;
  if (isHonor(b) && !isHonor(m)) {
    const rm = runsFor(m);
    return `${lead} But a single ${kindWord(b)} only becomes a group if you pick up two more of it, while your ${t(m)} can also grow into a run (${rm.join(" or ")}). Keep the ${numOf(m)}.`;
  }
  if (!isHonor(b) && !isHonor(m)) {
    const rb = runsFor(b), rm = runsFor(m);
    if (rm.length > rb.length) {
      const fits = rb.length === 1 ? `fits only one (${rb[0]})` : `fits only ${rb.length} (${rb.join(" or ")})`;
      return `${lead} But a lone ${numOf(m)} can still grow into ${rm.length} different runs (${rm.join(", ")}), while a lone ${numOf(b)} ${fits}. Keeping the ${numOf(m)} gives you more ways to make a group.`;
    }
  }
  // same shape on both sides: the difference is how many of the tiles each needs are still out there
  return `${lead} But more of the tiles that would help your ${t(m)} are still out there, so keeping it leaves you more ways in: ${best.ukeire} useful tiles instead of ${mine.ukeire}.`;
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
      p.push(`<p>Taking it ${pick.shanten < ev.base.shanten ? `would also have left you needing just <b>${needing(pick.shanten)}</b>` : `would have kept you at ${needing(pick.shanten)}`}.</p>`);
      p.push(`<p class="tip">Tip: if you have two dragons, or two of your wind, take the third.</p>`);
    } else {
      p.push(`<p>This ${call} would have left you needing <b>${needing(pick.shanten)}</b>. Without it you still needed ${moreTiles(ev.base.shanten)}.</p>`);
      if (pick.shanten <= 0) p.push(`<p>Then, any of these tiles would've secured your win.</p>${tileStrip(pick.tiles, unseen)}`);
    }
    return note(before, {
      kind: "claim",
      title: `Taking the ${tileName(k)} would have helped`,
      bubble: `Taking that ${tileName(k)} would have helped.`,
      // the green box: the call you could have made, as a set
      set: { label: `You should've claimed a ${call}`, k, tiles: callSet(pick, k) },
      html: p.join(""),
    });
  }

  // you claimed, passing was clearly better
  if (pick.type === "pass") {
    const mine = ev.choices.find((ch) => ch.type === resp.type && (resp.type !== "chow" || String(ch.chow) === String(resp.chow)));
    if (!mine) return null;
    const p = [];
    p.push(`<p>Taking ${resp.type === "chow" ? chowTiles(resp.chow, k) : t(k)} left you needing <b>${needing(mine.shanten)}</b>. ${mine.shanten > ev.base.shanten ? `Before, you needed ${moreTiles(ev.base.shanten)}.` : `That's no closer than before.`}</p>`);
    p.push(`<p><b>Why:</b> ${claimWhy(before, resp.type, resp.chow, k)}</p>`);
    if (ev.closed && before.points !== false) p.push(`<p>It also showed your tiles to everyone, and you lost the <b>1 point</b> for never taking a tile.</p>`);
    if (!mine.fanPath && before.points !== false) p.push(`<p>Nothing in your hand earns points yet, so winning is now harder.</p>`);
    p.push(before.points === false
      ? `<p class="tip">Tip: taking a tile locks those tiles into a set and shows your hand to everyone, so only take one if it gets you closer to winning.</p>`
      : `<p class="tip">Tip: taking a tile locks those tiles into a set and shows your hand to everyone, so only take one if it gets you closer to winning, or if it's a dragon or your own wind.</p>`);
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

/* Why a call didn't get you closer to winning: the tiles it used were already doing a job in your hand
   (a finished run, three of a kind, your only pair), so it swapped one group for another.
   c = your hand before the call, type = "pung" | "kong" | "chow", chow = your two tiles for a chow. */
function claimWhy(state, type, chow, k) {
  const pl = state.players[0];
  const c = handCounts(pl);
  // closest to a hand you can only make without taking tiles: any call ends it
  const shape = closestShape(c, pl.melds.length, unseenFor(state, 0));
  if (shape === "orphans") return `Your hand is closest to <b>Thirteen orphans</b> (one of every 1, 9, wind and dragon), and that hand can only be made without taking tiles.`;
  if (shape === "sevenPairs") return `Your hand is closest to <b>Seven pairs</b>, and that hand can only be made without taking tiles.`;
  const used = type === "chow" ? chow : [k];
  const pairs = c.filter((n) => n === 2).length;  // three of a kind is a finished group, not a pair
  if (type !== "chow" && c[k] >= 3)
    return `You already had three ${t(k)}, which is a finished group. Another one doesn't make a new group.`;
  if (type !== "chow" && c[k] === 2 && runWith(k, c))
    return `One of your two ${t(k)} was already part of your ${runWith(k, c).seq} run. Making three of them breaks that run, so you've swapped one group for another.`;
  if (type !== "chow" && c[k] === 2 && pairs === 1)
    return `Your two ${t(k)} were your only pair. Every winning hand needs a pair, so turning them into three just means you need a new one.`;
  for (const x of used) {
    const run = runWith(x, c);
    if (!run || c[x] !== 1) continue;
    const both = used.length === 2 && used.every((y) => y >= run.lo && y <= run.lo + 2 && c[y] === 1);
    if (run)
      return `Your ${both ? `${t(used[0])} and ${t(used[1])} were` : `${t(x)} was`} already part of your ${run.seq} run. Using ${both ? "them" : "it"} here breaks that run, so you've swapped one group for another.`;
  }
  if (type === "chow") {
    for (const x of used) {
      if (c[x] >= 3) return `Using your ${t(x)} broke up your three ${t(x)}, so you've swapped one group for another.`;
      if (c[x] === 2 && pairs === 1) return `Using your ${t(x)} broke up your only pair, and every winning hand needs one.`;
    }
    const inPairs = used.filter((x) => c[x] === 2);
    if (inPairs.length === 2) return `Your ${t(inPairs[0])} and ${t(inPairs[1])} were each one of a pair. Using them breaks up those pairs, so you've swapped one shape for another.`;
    if (inPairs.length === 1) return `Your ${t(inPairs[0])} was one of a pair. Using it breaks up that pair, so you've swapped one shape for another.`;
  }
  return `The tiles you used were already close to making a group, so this just swapped one group you were building for another.`;
}

/* "This peng would get you one tile closer to winning." */
const WORD = ["no", "one", "two", "three", "four", "five"];
function closerBy(call, n) {
  if (n <= 0) return `This ${call} keeps you just as close to winning.`;
  return `This ${call} would get you ${WORD[n] || n} tile${n === 1 ? "" : "s"} closer to winning.`;
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
  if (run && from !== 3) return `You can only make runs with tiles from ${left}, the player before you.`;
  return "You don't have the tiles to make a set with it. Let it go.";
}

export function hint(state) {
  if (state.phase === "act" && state.current === 0) {
    const opts = actOptions(state, 0);
    // no green box here: the card's own red Mahjong button (at the bottom, like the one in the white box) wins
    if (opts.tsumo && opts.tsumo.legal) return { title: "You can win", win: true, html: state.points === false ? `<p>Your hand is complete. Tap <b>Mahjong</b> to win.</p>` : `<p>Your hand is complete, and it's worth <b>${opts.tsumo.fan} point${opts.tsumo.fan === 1 ? "" : "s"}</b>. Tap <b>Mahjong</b> to win.</p>` };
    const { ranked, c, habit, top0, near, best } = coachPick(state);
    const top = [best, ...ranked.list.filter((r) => r !== best)].slice(0, 3);
    const role = throwReason(best.k, ranked.counts, ranked.unseen);
    const rows = top.map((r) => `<li>${t(r.k)}<span>${toWin(r.shanten)}</span><span>${helps(r.ukeire)}</span></li>`).join("");
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
      ? `<p>${role.lead || `It's ${role.text}`}.</p>`
      : roles.every((r) => r.text === roles[0].text)
        ? `<p>These are equally good. Each one is ${roles[0].text}.</p>`
        : `<p>These are equally good, so throw ${either}.</p>`;
    // the numbers slightly favoured breaking your only pair: say why the coach didn't
    const pairNote = top0 !== best && habit(top0) === 3
      ? (c[top0.k] >= 3
        ? `<p><b>Why not ${t(top0.k)}?</b> On paper it keeps a few more tiles in play, but you have three of them, a finished group. Keep it.</p>`
        : `<p><b>Why not ${t(top0.k)}?</b> On paper it keeps a few more tiles in play, but it's your only pair. Every winning hand needs one, so keep it.</p>`)
      : "";
    let html = `${lead}${pairNote}${keptHtml}`
      + `<p>Your top choices:</p><ul class="hint-list">${rows}</ul>`;
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
      // explain using the call you'd most likely try: a peng if you can, otherwise the first chow
      const o = state.claim.options[0];
      if (rec.reason === "keep-closed") {
        const best = rec.ev.choices.filter((ch) => ch.type !== "win").sort((x, y) => x.shanten - y.shanten)[0];
        return { title: "Here's what I'd do", pick: { k, label: "Let it go" },
          html: `<p>Taking it would leave you needing ${needing(best.shanten)}, a step closer. But you'd show your tiles and give up the <b>1 point</b> for never taking a tile, and you're still far from winning. Waiting is the better choice.</p>` };
      }
      const why = o.pung ? claimWhy(state, "pung", null, k)
        : o.chows?.length ? claimWhy(state, "chow", o.chows[0], k) : "";
      return { title: "Here's what I'd do", pick: { k, label: "Let it go" }, html: `<p>Taking it won't get you closer. You'd still need ${needing(rec.ev.base.shanten)}.${rec.ev.closed && state.points !== false ? " Never taking a tile also earns 1 point." : ""}</p>`
          + (why ? `<p><b>Why:</b> ${why}</p>` : "") };
    }
    // the card names the call and shows the whole set: your own tiles (drawn a little see-through) and the thrown-away one
    const set = callSet(pick, k);
    // the green box already shows the set, so the sentence just names the call
    const call = pick.type === "pung" ? "peng" : pick.type;
    return { title: "Here's what I'd do", pick: { k, label: `Claim a ${call}`, set },
      html: `<p>${closerBy(call, rec.ev.base.shanten - pick.shanten)}${rec.reason === "value" ? " It also earns a point." : ""}</p>` };
  }
  return { title: "Waiting", html: `<p>It's not your turn yet. I'll speak up if I spot something.</p>` };
}

export { isValueTile, handCounts, isSuited, WIND_EN };
