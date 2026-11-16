// The coach: compares each of your decisions with the best move it can find and, when yours
// was clearly worse, writes a note explaining why. Notes are plain objects rendered by ui.js.
import { kindOf, isHonor, isTerminal, isSuited, suitOf, numOf, isDragon } from "./engine.js";
import { tileHtml, tileName } from "./tiles.js";
import { actOptions, unseenFor, handCounts, seatWind } from "./game.js";
import { rankDiscards, recommendClaim, isValueTile } from "./strategy.js";

const t = (k, size = "xs") => tileHtml(k, { size, title: true });
const WIND_EN = ["East", "South", "West", "North"];

function away(s) {
  if (s < 0) return "a complete hand";
  if (s === 0) return "ready: one tile from winning";
  if (s === 1) return "1 tile from ready";
  return `${s} tiles from ready`;
}

function tileStrip(kinds, unseen) {
  if (!kinds.length) return "";
  return `<div class="strip">${kinds.map((k) => `<span class="strip-item">${t(k)}<small>×${unseen[k]}</small></span>`).join("")}</div>`;
}

/* What job a tile was doing in hand c (14-tile shape including it). */
function roleOf(k, c, unseen) {
  const n = c[k];
  if (n >= 3) return { kind: "set", text: "part of a complete set of three" };
  if (n === 2) {
    if (isHonor(k)) return { kind: "pair", text: "a pair, which can still become a pung" };
    return { kind: "pair", text: "a pair, the natural candidate for your hand's eyes (the pair every hand needs)" };
  }
  if (isHonor(k)) {
    const left = unseen[k];
    return {
      kind: "lone-honor",
      text: `a lone honor tile. Honors can't form sequences, so it only helps if you draw ${left === 0 ? "a copy, and none are left" : `one of the ${left} remaining copies`}`,
    };
  }
  const near = [];
  for (const d of [-2, -1, 1, 2]) {
    const x = k + d;
    if (x >= 0 && x < 27 && suitOf(x) === suitOf(k) && c[x]) near.push(x);
  }
  if (!near.length) {
    if (isTerminal(k)) return { kind: "lone-terminal", text: `a lone ${numOf(k)}. A 1 or 9 can only grow a sequence on one side, so it's one of the weakest tiles to hold` };
    return { kind: "lone", text: "an isolated tile with nothing next to it yet" };
  }
  const adj = near.filter((x) => Math.abs(x - k) === 1);
  if (adj.length >= 2) return { kind: "seq", text: `in the middle of a run (${near.map((x) => numOf(x)).join(", ")} nearby), so it's holding a sequence together` };
  return { kind: "shape", text: `connected to the ${near.map((x) => numOf(x)).join(" and ")} next to it, a partial sequence that's waiting on one tile` };
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
    p.push(`<p>${q} already ${ranked.threats.length > 1 ? "have" : "has"} three sets showing, so ${ranked.threats.length > 1 ? "they're" : "they're"} probably close to winning. You're still ${away(mine.shanten)}, so the race isn't yours to win right now.</p>`);
    p.push(`<p>${t(best.k)} was a safer discard: ${best.danger === 0 ? "it's already in their discards, so they can't win on it" : "it's much less likely to be the tile they need"}. ${t(k)} ${mine.danger >= 5 ? "is a middle tile that fits into lots of waits" : "could easily be what they're waiting for"}.</p>`);
    p.push(`<p class="tip">When someone shows three sets and you're 2+ tiles from ready, stop building and throw tiles they've already discarded.</p>`);
    return note(before, {
      kind: "defense",
      title: `${tileName(best.k)} was the safer discard`,
      bubble: `Careful: ${before.players[ranked.threats[0]].name} looks close to winning.`,
      compare: { mine: { k, label: "You threw" }, best: { k: best.k, label: "Safer" } },
      html: p.join(""),
    });
  }
  p.push(`<p>After discarding ${t(k)} you were <b>${away(mine.shanten)}</b>, with <b>${mine.ukeire}</b> tile${mine.ukeire === 1 ? "" : "s"} left that could help.</p>`);
  p.push(`<p>Discarding ${t(best.k)} instead keeps you <b>${away(best.shanten)}</b>, with <b>${best.ukeire}</b> tiles that help:</p>`);
  p.push(tileStrip(best.tiles, unseen));
  p.push(`<p><b>Why:</b> ${t(best.k)} was ${roleBest.text}. Your ${t(k)} was ${roleMine.text}.</p>`);
  if (worseShape) p.push(`<p>Breaking that up set you back a whole step from ready.</p>`);
  p.push(`<p class="tip">${tipFor(roleBest, roleMine, before)}</p>`);
  return note(before, {
    kind: "discard",
    title: `${tileName(best.k)} was the better discard`,
    bubble: worseShape ? `That discard set you back a step. Tap to see why.` : `There was a discard with more ways to improve.`,
    compare: worseShape
      ? { mine: { k, label: "You threw", sub: `${mine.shanten} from ready` }, best: { k: best.k, label: "Better", sub: best.shanten === 0 ? "Ready" : `${best.shanten} from ready` } }
      : { mine: { k, label: "You threw", sub: `${mine.ukeire} tiles help` }, best: { k: best.k, label: "Better", sub: `${best.ukeire} tiles help` } },
    html: p.join(""),
  });
}

function tipFor(roleBest, roleMine, state) {
  if (roleBest.kind === "lone-honor") return "Tip: early on, let go of lone winds and dragons that don't score for you. They can only ever become a pair or pung.";
  if (roleBest.kind === "lone-terminal") return "Tip: 1s and 9s connect on only one side. Middle tiles (3 to 7) connect on both, so they're worth more.";
  if (roleMine.kind === "seq" || roleMine.kind === "shape") return "Tip: count the tiles that would help you after each possible discard. Keep the shapes with the most ways in.";
  if (roleMine.kind === "pair") return "Tip: a hand needs exactly one pair. Keep at least one pair unless you have a better candidate.";
  return "Tip: before each discard, ask which tile does the least work for your hand.";
}

function missedWinNote(state, win, selfDraw) {
  const arr = win.arrangement;
  const items = win.items.map(([n, f]) => `<li><span>${n}</span><span>${f}</span></li>`).join("");
  const html = [
    `<p>Your hand was complete, and it was worth <b>${win.fan} fan</b>. ${selfDraw ? "You could have declared a self-drawn win." : "You could have claimed that discard to win."}</p>`,
    arr && !arr.special ? `<p>It split into four sets and a pair:</p>${arrangementHtml(state, arr, selfDraw)}` : "",
    `<ul class="fan-list">${items}</ul>`,
    `<p class="tip">The Win button lights up whenever your hand is complete and scores at least ${state.minFan} fan. It's always worth a look before you discard.</p>`,
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
    const name = pick.type === "chow" ? "chow" : pick.type;
    const p = [];
    if (rec.reason === "value") {
      p.push(`<p>A ${pick.type} of ${t(k)} is worth <b>1 fan</b> on its own${isDragon(k) ? " (every dragon pung scores)" : ` (it's ${k - 27 === seatWind(before, 0) ? "your seat wind" : "the round wind"})`}.</p>`);
      p.push(`<p>Claiming it ${pick.shanten < ev.base.shanten ? `also takes you from ${away(ev.base.shanten)} to <b>${away(pick.shanten)}</b>` : `keeps you ${away(pick.shanten)}`}, and it guarantees your hand can score even with other sets claimed.</p>`);
      p.push(`<p class="tip">Tip: pungs of dragons, your seat wind and the round wind are almost always worth claiming. Their fan is what lets you win off discards.</p>`);
    } else {
      p.push(`<p>${pick.type === "chow" ? `Chowing ${chowTiles(pick.chow, k)}` : `Punging ${t(k)}`} would have made you <b>${away(pick.shanten)}</b>${pick.discard !== null && pick.discard !== undefined ? ` after discarding ${t(pick.discard)}` : ""}. Without it you stayed ${away(ev.base.shanten)}.</p>`);
      if (pick.shanten <= 0) p.push(`<p>Once you're ready, any of these wins:</p>${tileStrip(pick.tiles, unseen)}`);
      p.push(`<p class="tip">Tip: when a claim makes you ready, take it. Speed matters most at the end of a hand.</p>`);
    }
    return note(before, {
      kind: "claim",
      title: `You should have claimed ${from}'s ${tileName(k)}`,
      bubble: `You passed on a good ${name}. Tap to see why.`,
      html: p.join(""),
    });
  }

  // you claimed, passing was clearly better
  if (pick.type === "pass") {
    const mine = ev.choices.find((ch) => ch.type === resp.type && (resp.type !== "chow" || String(ch.chow) === String(resp.chow)));
    if (!mine) return null;
    const p = [];
    p.push(`<p>Claiming ${resp.type === "chow" ? chowTiles(resp.chow, k) : t(k)} left you <b>${away(mine.shanten)}</b>. ${mine.shanten > ev.base.shanten ? `That's further away than the <b>${away(ev.base.shanten)}</b> you were before.` : `That's no closer than you were before.`}</p>`);
    if (ev.closed) p.push(`<p>It also opened your hand. That gives up the <b>1 fan</b> for a concealed hand, and it shows the other players what you're collecting.</p>`);
    if (!mine.fanPath) p.push(`<p>Worse, nothing else in your hand scores a fan yet, so with your hand open you may only be able to win on a tile you draw yourself.</p>`);
    p.push(`<p class="tip">Tip: only claim when it moves you closer to winning, or when the set itself scores (a dragon or a wind that's yours).</p>`);
    return note(before, {
      kind: "claim",
      title: `Passing on that ${resp.type} was better`,
      bubble: `That ${resp.type} didn't get you any closer.`,
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
    if (opts.tsumo && opts.tsumo.legal) return { title: "Declare your win", html: `<p>Your hand is complete and worth <b>${opts.tsumo.fan} fan</b>. Tap <b>Win</b>.</p>` };
    const ranked = rankDiscards(state, 0);
    const top = ranked.list.slice(0, 3);
    const best = top[0];
    const role = roleOf(best.k, ranked.counts, ranked.unseen);
    const rows = top.map((r) => `<li>${t(r.k)}<span>${away(r.shanten)}</span><span>${r.ukeire} tiles help</span></li>`).join("");
    let html = `<p>I'd discard ${t(best.k)}. It's ${role.text}.</p><ul class="hint-list">${rows}</ul>`;
    if (ranked.threats.length) html += `<p class="tip">Heads up: ${ranked.threats.map((q) => state.players[q].name).join(" and ")} ${ranked.threats.length > 1 ? "have" : "has"} three sets showing. Tiles they've discarded are safe.</p>`;
    if (opts.kongs.length) html += `<p class="tip">You can also declare a kong of ${opts.kongs.map((x) => t(x.k)).join("")}. It gets you a replacement tile.</p>`;
    return { title: "My pick", html };
  }
  if (state.phase === "claim" && state.claim?.options[0] && !state.claim.responses[0]) {
    const rec = recommendClaim(state, 0, state.claim.options[0]);
    const pick = rec.pick;
    const k = rec.ev.k;
    if (pick.type === "win") return { title: "Win!", html: `<p>That ${t(k)} completes your hand. Claim it.</p>` };
    if (pick.type === "pass") {
      return { title: "I'd pass", html: `<p>Claiming ${t(k)} wouldn't get you closer than ${away(rec.ev.base.shanten)}${rec.ev.closed ? ", and keeping your hand concealed is worth a fan" : ""}.</p>` };
    }
    return { title: `I'd ${pick.type}`, html: `<p>${pick.type === "chow" ? chowTiles(pick.chow, k) : t(k)} gets you to ${away(pick.shanten)}${rec.reason === "value" ? " and scores a fan" : ""}.</p>` };
  }
  return { title: "Waiting", html: `<p>It's not your move yet. I'll speak up if I see something.</p>` };
}

export { isValueTile, handCounts, isSuited, WIND_EN };
