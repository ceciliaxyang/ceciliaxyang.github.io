// The coach: compares each of your decisions with the best move it can find and, when yours
// was clearly worse, writes a note explaining why. Notes are plain objects rendered by ui.js.
// Voice: written for a first-time player. No jargon without saying what it means in the same breath
// ("points", not "fan"; "tiles away from winning", not "shanten" or "ready"; "a group of three", not "a meld").
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
  if (n >= 3) return { kind: "set", text: "part of a finished group of three" };
  if (n === 2) {
    const dead = unseen[k] === 0;  // both other copies are already discarded or called
    if (isHonor(k)) return { kind: "pair", text: dead ? "a pair. The other two copies are already gone, so it can stay a pair but never grow to three" : "a pair, which could still grow into three of a kind" };
    return { kind: "pair", text: `a pair, and every winning hand needs exactly one pair${dead ? ". The other two copies are already gone, so it can't grow to three" : ""}` };
  }
  if (isHonor(k)) {
    const left = unseen[k];
    return {
      kind: "lone-honor",
      text: `a single ${isDragon(k) ? "dragon" : "wind"}. Winds and dragons can't make runs like 3-4-5, only matching sets, so it helps only if you get ${left === 0 ? "another copy, and there are none left" : `another copy (${left} left)`}`,
    };
  }
  const near = [];
  for (const d of [-2, -1, 1, 2]) {
    const x = k + d;
    if (x >= 0 && x < 27 && suitOf(x) === suitOf(k) && c[x]) near.push(x);
  }
  if (!near.length) {
    if (isTerminal(k)) return { kind: "lone-terminal", text: `a lone ${numOf(k)}. A 1 or 9 can only join a run from one side (like ${numOf(k) === 1 ? "1-2-3" : "7-8-9"}), so it's one of the hardest tiles to use` };
    return { kind: "lone", text: "on its own, with no nearby tiles of the same suit" };
  }
  const adj = near.filter((x) => Math.abs(x - k) === 1);
  if (adj.length >= 2) return { kind: "seq", text: `in the middle of a run with the ${near.map((x) => numOf(x)).join(" and ")}, holding it together` };
  // what the partial sequence is waiting for, counting only copies that aren't already discarded or called
  const x = near[0], lo = Math.min(k, x), hi = Math.max(k, x);
  const waits = (hi - lo === 2 ? [lo + 1] : [lo - 1, hi + 1]).filter((w) => w >= 0 && w < 27 && suitOf(w) === suitOf(k));
  const left = waits.reduce((n, w) => n + unseen[w], 0);
  const gone = waits.length * 4 - left - waits.reduce((n, w) => n + (c[w] || 0), 0);
  const deadNote = left === 0
    ? `. But every ${waits.map((w) => numOf(w)).join(" and ")} it needs has already been thrown away or taken, so it can't finish`
    : left <= 2 && gone > 0 ? `. But only ${left} of the ${waits.map((w) => numOf(w)).join(" or ")} it needs ${left === 1 ? "is" : "are"} left (${gone} already thrown away or taken)` : "";
  return { kind: "shape", text: `half of a run with the ${near.map((x) => numOf(x)).join(" and ")}, one tile short of three in a row (it needs a ${waits.map((w) => numOf(w)).join(" or ")})${deadNote}` };
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
  const ranked = rankDiscards(before, 0);
  const k = kindOf(action.id);
  const mine = ranked.list.find((r) => r.k === k);
  const best = ranked.list[0];
  if (!mine || best.k === k) return null;
  const worseShape = mine.shanten > best.shanten;
  const fewer = mine.shanten === best.shanten && best.ukeire - mine.ukeire >= Math.max(4, best.ukeire * 0.25);
  // if you threw a safe tile while someone looked ready, that's defence, not a mistake
  const defending = ranked.threats.length && mine.danger === 0 && best.danger > 0;
  const unsafe = ranked.threats.length && mine.danger >= 4 && best.danger === 0 && mine.shanten >= 1;
  if (defending && !worseShape) return null;
  if (!worseShape && !fewer && !unsafe) return null;

  const c = ranked.counts;
  const unseen = ranked.unseen;
  const roleBest = roleOf(best.k, c, unseen);
  const roleMine = roleOf(k, c, unseen);
  const p = [];
  if (unsafe && !worseShape && !fewer) {
    const q = ranked.threats.map((x) => before.players[x].name).join(" and ");
    p.push(`<p>${q} already ${ranked.threats.length > 1 ? "have" : "has"} three groups face up on the table, so ${ranked.threats.length > 1 ? "they're" : "they're"} probably close to winning. You're still ${away(mine.shanten)}, so you're unlikely to win first.</p>`);
    p.push(`<p>If you throw the exact tile they need, they win with it and you pay. ${t(best.k)} was safer: ${best.danger === 0 ? "they threw one away themselves, and you can't win on a tile you've thrown away" : "it's much less likely to be the tile they need"}. ${t(k)} ${mine.danger >= 5 ? "is a middle number, and middle numbers finish lots of hands" : "could easily be the one they need"}.</p>`);
    p.push(`<p class="tip">Tip: when someone has three groups showing and you're far from winning, play it safe. Throw away tiles they've already thrown away.</p>`);
    return note(before, {
      kind: "defense",
      title: `${tileName(best.k)} was the safer tile to throw away`,
      bubble: `Careful: ${before.players[ranked.threats[0]].name} looks close to winning.`,
      compare: { mine: { k, label: "You threw" }, best: { k: best.k, label: "Safer" } },
      html: p.join(""),
    });
  }
  p.push(`<p>Throwing away ${t(k)} left you <b>${away(mine.shanten)}</b>.</p>`);
  // a short list of the tiles you'd hope for is useful; early in a hand it's a wall of tiles, so just give the count
  if (best.tiles.length <= 8) {
    p.push(`<p>Throwing away ${t(best.k)} instead would have left you <b>${away(best.shanten)}</b>${worseShape ? "" : `, with more chances to get there`}. These are the tiles you'd be hoping to pick up next (the number is how many are still out there):</p>`);
    p.push(tileStrip(best.tiles, unseen));
  } else {
    p.push(`<p>Throwing away ${t(best.k)} instead would have left you <b>${away(best.shanten)}</b>${worseShape ? "" : `, with more chances to get there`}.</p>`);
  }
  if (!worseShape) p.push(`<p>There are <b>${best.ukeire}</b> tiles still out there that would move you closer, compared with <b>${mine.ukeire}</b> after the one you threw.</p>`);
  p.push(`<p><b>Why:</b> ${t(best.k)} was ${roleBest.text}. Your ${t(k)} was ${roleMine.text}.</p>`);
  if (worseShape) p.push(`<p>Breaking that up moved you a step further from winning.</p>`);
  p.push(`<p class="tip">${tipFor(roleBest, roleMine, before)}</p>`);
  return note(before, {
    kind: "discard",
    title: `${tileName(best.k)} was the better tile to throw away`,
    bubble: worseShape ? `That one moved you further from winning. Tap to see why.` : `Another tile was a better one to let go. Tap to see why.`,
    compare: worseShape
      ? { mine: { k, label: "You threw", sub: awayShort(mine.shanten) }, best: { k: best.k, label: "Better", sub: awayShort(best.shanten) } }
      : { mine: { k, label: "You threw", sub: helps(mine.ukeire) }, best: { k: best.k, label: "Better", sub: helps(best.ukeire) } },
    html: p.join(""),
  });
}

function tipFor(roleBest, roleMine, state) {
  if (roleBest.kind === "lone-honor") return "Tip: early in a hand, throw away single winds and dragons first. They can only become a pair or three of a kind, never a run.";
  if (roleBest.kind === "lone-terminal") return "Tip: 1s and 9s can only join a run from one side. Middle numbers (3 to 7) fit from both sides, so keep those.";
  if (roleMine.kind === "seq" || roleMine.kind === "shape") return "Tip: keep tiles that sit next to each other in the same suit (like 4 and 5). They're well on the way to a run.";
  if (roleMine.kind === "pair") return "Tip: a winning hand is four groups of three plus one pair. Hold on to at least one pair.";
  return "Tip: a winning hand is four groups of three plus one pair. Each turn, let go of the tile that's doing the least to get you there.";
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
        `<p>Your hand was complete. ${selfDraw ? "You could have won with the tile you just picked up." : "You could have taken that thrown-away tile and won."}</p>`,
        arr && !arr.special ? `<p>It made four groups of three plus a pair:</p>${arrangementHtml(state, arr, selfDraw)}` : "",
        `<p class="tip">Tip: the Win button lights up whenever your hand is complete. Check for it before you throw a tile away.</p>`,
      ].join(""),
    });
  }
  // each scoring line with a one-line plain explanation (from the scoring guide) under its name
  const why = (n) => (FAN_GUIDE.find(([g]) => g === n || (n.endsWith("dragon peng") && g === "Dragon peng")) || [])[2];
  const items = win.items.map(([n, f]) => `<li><span>${n}${why(n) ? `<small>${why(n)}</small>` : ""}</span><span>${f} pt${f === 1 ? "" : "s"}</span></li>`).join("");
  const html = [
    `<p>Your hand was a winner, worth <b>${win.fan} point${win.fan === 1 ? "" : "s"}</b> (in mahjong, points are called <i>fan</i>). ${selfDraw ? "You could have won with the tile you just picked up." : "You could have taken that thrown-away tile and won."}</p>`,
    arr && !arr.special ? `<p>It made four groups of three plus a pair:</p>${arrangementHtml(state, arr, selfDraw)}` : "",
    `<p>Where the points came from:</p><ul class="fan-list">${items}</ul>`,
    `<p class="tip">Tip: the Win button lights up whenever your hand can win (you need at least ${state.minFan} point${state.minFan === 1 ? "" : "s"}). Check for it before you throw a tile away.</p>`,
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
    if (rec.reason === "value") {
      p.push(`<p>Three ${t(k)} in a row (a <i>peng</i>) is worth <b>1 point</b> by itself${isDragon(k) ? ": three of any dragon always scores" : `, because ${k - 27 === seatWind(before, 0) ? "it's your own wind (the one shown in your circle)" : "it's this round's wind"}`}. You need points to be allowed to win.</p>`);
      p.push(`<p>Taking it ${pick.shanten < ev.base.shanten ? `would also have moved you from ${away(ev.base.shanten)} to <b>${away(pick.shanten)}</b>` : `would have kept you ${away(pick.shanten)}`}.</p>`);
      p.push(`<p class="tip">Tip: when someone throws away a dragon, or your own wind, and you already have two, take it. Those sets give you points.</p>`);
    } else {
      p.push(`<p>Taking that tile to make ${pick.type === "chow" ? `the run ${chowTiles(pick.chow, k)} (a <i>chow</i>)` : `three ${t(k)} (a <i>peng</i>)`} would have left you <b>${away(pick.shanten)}</b>${pick.discard !== null && pick.discard !== undefined ? ` after throwing away ${t(pick.discard)}` : ""}. Without it you stayed ${away(ev.base.shanten)}.</p>`);
      if (pick.shanten <= 0) p.push(`<p>Then any of these would have won it for you (the number is how many are still out there):</p>${tileStrip(pick.tiles, unseen)}`);
      p.push(`<p class="tip">Tip: if taking a thrown-away tile puts you 1 tile away from winning, take it.</p>`);
    }
    return note(before, {
      kind: "claim",
      title: `Taking ${from}'s ${tileName(k)} would have helped`,
      bubble: `Taking that ${tileName(k)} would have helped. Tap to see why.`,
      html: p.join(""),
    });
  }

  // you claimed, passing was clearly better
  if (pick.type === "pass") {
    const mine = ev.choices.find((ch) => ch.type === resp.type && (resp.type !== "chow" || String(ch.chow) === String(resp.chow)));
    if (!mine) return null;
    const p = [];
    p.push(`<p>Taking ${resp.type === "chow" ? chowTiles(resp.chow, k) : t(k)} left you <b>${away(mine.shanten)}</b>. ${mine.shanten > ev.base.shanten ? `Before, you were <b>${away(ev.base.shanten)}</b>, so it moved you further away.` : `That's no closer than before.`}</p>`);
    if (ev.closed && before.points !== false) p.push(`<p>It also put tiles face up on the table. A hand where you never take anyone's thrown-away tile earns <b>1 extra point</b>, and now everyone can see what you're collecting.</p>`);
    if (!mine.fanPath && before.points !== false) p.push(`<p>And nothing in your hand earns points yet. You need points to win, so this makes winning harder.</p>`);
    p.push(before.points === false
      ? `<p class="tip">Tip: only take someone's thrown-away tile if it gets you closer to winning.</p>`
      : `<p class="tip">Tip: only take someone's thrown-away tile if it gets you closer to winning, or if it's a dragon or your own wind (those earn points).</p>`);
    return note(before, {
      kind: "claim",
      title: `Letting that ${tileName(k)} go was better`,
      bubble: `Taking that tile didn't get you any closer to winning.`,
      html: p.join(""),
    });
  }
  return null;
}

function chowTiles(ch, k) {
  return [...ch, k].sort((a, b) => a - b).map((x) => t(x)).join("");
}

/* ---------- On-demand hint ---------- */

export function hint(state) {
  if (state.phase === "act" && state.current === 0) {
    const opts = actOptions(state, 0);
    if (opts.tsumo && opts.tsumo.legal) return { title: "You can win", pick: { label: "Tap Win" }, html: state.points === false ? `<p>Your hand is complete. Tap <b>Win</b>.</p>` : `<p>Your hand is a winner, worth <b>${opts.tsumo.fan} point${opts.tsumo.fan === 1 ? "" : "s"}</b>. Tap <b>Win</b>.</p>` };
    const ranked = rankDiscards(state, 0);
    const top = ranked.list.slice(0, 3);
    const best = top[0];
    const role = roleOf(best.k, ranked.counts, ranked.unseen);
    const rows = top.map((r) => `<li>${t(r.k)}<span>${awayShort(r.shanten)}</span><span>${helps(r.ukeire)}</span></li>`).join("");
    // single winds or dragons the coach is keeping because they can earn points: say so, since beginners expect
    // lone honors to go first
    const kept = ranked.list.filter((r) => r.k !== best.k && isHonor(r.k) && ranked.counts[r.k] === 1 && isValueTile(state, 0, r.k)).map((r) => r.k);
    const why = (k) => isDragon(k) ? "three of any dragon always earn a point"
      : `it's ${k - 27 === seatWind(state, 0) && k - 27 === state.prevailing ? "your own wind and this round's wind (three of them earn 2 points)" : k - 27 === seatWind(state, 0) ? "your own wind (three of them earn a point)" : "this round's wind (three of them earn a point)"}`;
    const keptHtml = kept.length && !isHonor(best.k)
      ? `<p><b>Why not ${kept.map((k) => t(k)).join(" or ")}?</b> ${kept.map((k) => `${tileName(k)}: ${why(k)}`).join(". ")}. You need at least ${state.minFan} point${state.minFan === 1 ? "" : "s"} to win, so hold on to ${kept.length > 1 ? "them" : "it"} for now in case another copy comes.</p>`
      : "";
    let html = `<p>It's ${role.text}.</p>${keptHtml}`
      + `<p>Your best choices, with how far each leaves you from winning and how many tiles out there could help next:</p><ul class="hint-list">${rows}</ul>`;
    if (ranked.threats.length) html += `<p class="tip">Heads up: ${ranked.threats.map((q) => state.players[q].name).join(" and ")} ${ranked.threats.length > 1 ? "have" : "has"} three groups face up and may be close to winning. Tiles they've thrown away themselves are safe to throw.</p>`;
    if (opts.kongs.length) html += `<p class="tip">You have four ${opts.kongs.map((x) => t(x.k)).join("")}. You can set them down as a <i>kong</i> and pick up an extra tile.</p>`;
    return { title: "Here's what I'd do", pick: { k: best.k, label: "Throw away" }, html };
  }
  if (state.phase === "claim" && state.claim?.options[0] && !state.claim.responses[0]) {
    if (state.claim.options[0].none) return { title: "Here's what I'd do", pick: { k: kindOf(state.lastDiscard.id), label: "Let it go" }, html: `<p>It doesn't help your hand, so press Continue.</p>` };
    const rec = recommendClaim(state, 0, state.claim.options[0]);
    const pick = rec.pick;
    const k = rec.ev.k;
    if (pick.type === "win") return { title: "Here's what I'd do", pick: { k, label: "Take it and win" }, html: `<p>That ${t(k)} finishes your hand. Take it and win.</p>` };
    if (pick.type === "pass") {
      return { title: "Here's what I'd do", pick: { k, label: "Let it go" }, html: `<p>Taking ${t(k)} wouldn't get you any closer than ${away(rec.ev.base.shanten)}${rec.ev.closed && state.points !== false ? ". Also, never taking anyone's tile earns you 1 extra point" : ""}.</p>` };
    }
    return { title: "Here's what I'd do", pick: { k, label: "Take it" }, html: `<p>Making ${pick.type === "chow" ? `the run ${chowTiles(pick.chow, k)}` : `three ${t(k)}`} leaves you ${away(pick.shanten)}${rec.reason === "value" ? ", and it earns a point" : ""}.</p>` };
  }
  return { title: "Waiting", html: `<p>It's not your turn yet. I'll speak up if I spot something.</p>` };
}

export { isValueTile, handCounts, isSuited, WIND_EN };
