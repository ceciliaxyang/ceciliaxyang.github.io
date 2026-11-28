// Play many hands with the real engine and coach, collect every coach card, group them by wording pattern.
import { writeFileSync } from "node:fs";
const dir = process.argv[2];
const G = await import(dir + "/js/game.js");
const St = await import(dir + "/js/strategy.js");
const C = await import(dir + "/js/coach.js");
const T = await import(dir + "/js/tiles.js");
const { kindOf } = await import(dir + "/js/engine.js");
const clone = (o) => JSON.parse(JSON.stringify(o));
const HANDS = +(process.argv[3] || 400);

const setTilesHtml = (set, k) => `<div class="pick-set"><span class="pick-set-row">${set.map((x) => T.tileHtml(x.k, { size: "md", cls: x.mine ? "mine" : "" })).join("")}</span><span class="sub">${T.tileName(k)}</span></div>`;
const foot = (state, skip = null) => {
  const over = state.phase === "over";
  if (over && (!state.result || (state.result.type !== "draw" && state.result.winner === 0))) return "";
  const groups = C.awayShape(state, skip);
  let gap = 0;
  const shape = groups ? `<div class="foot-shape" aria-hidden="true">${groups.map((g) => `<span class="fs-tiles">${g.tiles.map((k) => (k === null ? `<span class="tile fs empty"><span>${++gap}</span></span>` : T.tileHtml(k, { size: "fs", title: false }))).join("")}</span>`).join("")}</div>` : "";
  let line = over ? C.awayNote(state).replace(/^You're /, "You ended ") : C.awayNote(state);
  const best = over && state._moves?.length ? Math.min(...state._moves.map((m) => m.away)) : null;
  if (best !== null && best >= 0 && best < C.distance(state)) line += ` The closest you got during this game was ${best + 1} tile${best === 0 ? "" : "s"} away.`;
  return `<div class="pane-foot"><p>${line}</p>${shape}</div>`;
};
// the card exactly as ui.js renderPane draws it
function noteCard(n, after) {
  const cmp = n.compare ? `<div class="compare"><div class="compare-card mine"><span class="lbl">${n.compare.mine.label}</span>${T.tileHtml(n.compare.mine.k, { size: "md" })}<span class="sub">${n.compare.mine.sub || T.tileName(n.compare.mine.k)}</span></div><div class="compare-card best"><span class="lbl">${n.compare.best.label}</span>${T.tileHtml(n.compare.best.k, { size: "md" })}<span class="sub">${n.compare.best.sub || T.tileName(n.compare.best.k)}</span></div></div>` : "";
  const setCard = n.set ? `<div class="compare single"><div class="compare-card best"><span class="lbl">${n.set.label}</span>${setTilesHtml(n.set.tiles, n.set.k)}</div></div>` : "";
  const undo = n.kind !== "summary" ? `<button type="button" class="btn light">Take it back</button>` : "";
  return `<h3>${n.title}</h3>${cmp}${setCard}${n.html}${foot(after)}<div class="pane-actions">${undo}<button type="button" class="btn">Got it</button></div>`;
}
function hintCard(h, state) {
  const ks = h?.pick ? (h.pick.ks || (h.pick.k !== undefined ? [h.pick.k] : [])) : [];
  const pickTiles = h?.pick?.set ? setTilesHtml(h.pick.set, h.pick.k)
    : ks.length ? `<div class="pick-tiles">${ks.map((k) => `<span class="pick-tile">${T.tileHtml(k, { size: "md" })}<span class="sub">${T.tileName(k)}</span></span>`).join("")}</div>` : "";
  const pickCard = h?.pick ? `<div class="compare single"><div class="compare-card best"><span class="lbl">${h.pick.label}</span>${pickTiles}</div></div>` : "";
  const action = h?.win ? `<button type="button" class="btn red">Mahjong</button>` : `<button type="button" class="btn">Got it</button>`;
  return `<h3>${h.title}</h3>${pickCard}${h.html}${foot(state, h.pick?.k ?? null)}<div class="pane-actions">${action}</div>`;
}

// a wording pattern: tiles, tile names, player names and numbers blanked out
const NAMES = Array.from({ length: 42 }, (_, k) => T.tileName(k)).filter(Boolean).sort((a, b) => b.length - a.length);
function shape(html) {
  let s = html.replace(/<span class="tile[^"]*"[^>]*>[\s\S]*?<\/svg><\/span>/g, "▢").replace(/<[^>]+>/g, " ");
  for (const n of NAMES) s = s.split(n).join("X");
  return s.replace(/Player \d/g, "P").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}
const firstPara = (html) => (html.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [, html])[1];

// the template branch behind a card: one key per kind of advice
const RULES = [
  ["turn-win", /^You can win/],
  ["turn-lone-honor", /^Here's what I'd do It's a single (dragon|wind)/],
  ["turn-lone-terminal", /^Here's what I'd do It's a lone #/],
  ["turn-lone", /^Here's what I'd do It's on its own/],
  ["turn-partial", /^Here's what I'd do (It's next to your|It needs a #)/],
  ["turn-spare-run", /^Here's what I'd do It's (a spare: your|the end of your)/],
  ["turn-extra-pair", /^Here's what I'd do It's (one of your # pairs|a pair, but|a spare copy|your fourth copy)/],
  ["turn-tie-same", /^Here's what I'd do These are equally good\. Each one/],
  ["turn-tie-diff", /^Here's what I'd do These are equally good, so throw/],
  ["claim-none", /(You can't claim it: )?[Yy]ou don't have the tiles to make a set/],
  ["claim-run-order", /(runs only take tiles from P|only make runs with tiles from P)/],
  ["claim-take-win", /This finishes your hand/],
  ["claim-take", /^Here's what I'd do This (chow|peng|kong) (would leave you|would get you|keeps you)/],
  ["claim-keep-closed", /Waiting is the better choice/],
  ["claim-pass", /^Here's what I'd do Taking it won't get you closer/],
  ["review-missed-win", /^You had a winning hand/],
  ["review-defense", /was the safer tile to throw away/],
  ["review-both-pairs", /are both pairs\./],
  ["review-both-lone", /are both on their own/],
  ["review-discard", /was the better tile to throw away/],
  ["review-should-claim", /would have helped/],
  ["review-let-go", /go was better/],
  ["summary-won", /^How you did this hand (You won this hand|Congratulations)/],
  ["summary-lesson", /^How you did this hand .*Next time:/],
  ["summary-praise", /^How you did this hand/],
];
const found = new Map(), other = new Map();
function keep(source, situation, title, html, card, force = null) {
  const s = shape(title + " " + html);
  const rule = force ? [force] : RULES.find(([, re]) => re.test(s));
  if (!rule) { other.set(s.slice(0, 120), (other.get(s.slice(0, 120)) || 0) + 1); return; }
  const key = rule[0];
  const e = found.get(key);
  if (e) { e.count++; if (e.examples.length < 4 && Math.random() < 0.25) e.examples.push(card); return; }
  found.set(key, { key, source, situation, count: 1, examples: [card] });
}

for (let hand = 0; hand < HANDS; hand++) {
  const state = G.createGame({ points: false });
  const moves = [], handNotes = [];
  let guard = 0;
  while (state.phase !== "over" && guard++ < 2000) {
    const ph = state.phase;
    if (ph === "draw") { G.drawTurn(state); continue; }
    if (ph === "act") {
      const p = state.current, o = G.actOptions(state, p);
      if (p === 0) {
        const h = C.hint(state);
        keep("hint", "Your turn: you tap the coach", h.title, h.html, hintCard(h, state));
        let a = St.botAct(state, 0, o);
        if (Math.random() < 0.35) { const hh = state.players[0].hand; a = { type: "discard", id: hh[Math.floor(Math.random() * hh.length)] }; }
        const before = clone(state);
        const n = C.reviewAct(before, a);
        if (a.type === "tsumo") G.tsumo(state, 0);
        else if (a.type === "kong") G.declareKong(state, 0, a.k, a.kongType);
        else { G.discard(state, 0, a.id); moves.push({ type: "discard", ok: !n, away: C.distance(state) }); }
        if (n) { handNotes.push(n); keep("note", n.kind === "win" ? "After your move: you missed a win" : n.kind === "defense" ? "After your discard: a risky throw" : "After your discard: a better throw existed", n.title, n.html, noteCard(n, state)); }
        continue;
      }
      const a = St.botAct(state, p, o);
      if (a.type === "tsumo") G.tsumo(state, p); else if (a.type === "kong") G.declareKong(state, p, a.k, a.kongType); else G.discard(state, p, a.id);
      continue;
    }
    if (ph === "claim") {
      for (const q of Object.keys(state.claim.options)) if (+q !== 0 && !state.claim.responses[q]) G.respond(state, +q, St.botClaim(state, +q, state.claim.options[q]));
      if (G.claimPendingFor(state, 0)) {
        const o = state.claim.options[0];
        const h = C.hint(state);
        keep("hint", "Someone discarded: you tap the coach", h.title, h.html, hintCard(h, state));
        let r = o.none ? { type: "pass" } : St.botClaim(state, 0, o);
        if (!o.none && Math.random() < 0.45) r = o.pung && Math.random() < 0.5 ? { type: "pung" } : o.chows?.length && Math.random() < 0.5 ? { type: "chow", chow: o.chows[0] } : { type: "pass" };
        const before = clone(state);
        const n = C.reviewClaim(before, r);
        G.respond(state, 0, r);
        if (!o.none && r.type !== "win") moves.push({ type: "claim", ok: !n, away: C.distance(state) });
        for (const q of Object.keys(state.claim.options)) if (+q !== 0 && !state.claim.responses[q]) G.respond(state, +q, St.botClaim(state, +q, state.claim.options[q]));
        G.resolveClaims(state);
        if (n) { handNotes.push(n); keep("note", n.kind === "win" ? "After passing: you missed a win" : "After a discard: taking or passing", n.title, n.html, noteCard(n, state)); }
        continue;
      }
      G.resolveClaims(state);
      continue;
    }
    break;
  }
  if (state.phase === "over") {
    state._moves = moves;
    const n = C.summaryNote(state, moves, handNotes, 0);
    keep("note", "End of the hand", n.title, n.html, noteCard(n, state), state.result.type === "draw" ? "summary-draw" : null);
  }
}
const list = [...found.values()].sort((a, b) => b.count - a.count);
writeFileSync(new URL("./patterns.json", import.meta.url), JSON.stringify(list));
for (const e of list) console.log(String(e.count).padStart(6), e.key, "|", e.situation, "|", e.examples.length);
console.log("unmatched:", [...other.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
