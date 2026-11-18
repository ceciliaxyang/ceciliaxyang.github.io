// Coach audit (dev only, not loaded by the game): plays many games where seat 0 follows the coach's hint,
// and records anything that looks wrong. Run in the browser console on the dev site:
//   const A = await import('/mahjong-coach/og/audit.js?t=' + Date.now()); await A.run(200)
const v = "?t=" + Date.now();
const G = await import("../js/game.js" + v);
const S = await import("../js/strategy.js" + v);
const C = await import("../js/coach.js" + v);
const E = await import("../js/engine.js" + v);
const T = await import("../js/tiles.js" + v);

const strip = (h) => h.replace(/<span class="tile[^]*?<\/svg><\/span>/g, (m) => {
  const n = m.match(/aria-label="([^"]+)"/); return `[${n ? n[1] : "tile"}]`;
}).replace(/<div class="strip">[^]*?<\/div>/g, "[strip]").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const clone = (o) => JSON.parse(JSON.stringify(o));

export async function run(games = 100, { points = false, noFlowers = true, random = 0 } = {}) {
  const issues = {}, samples = {}, stats = { decisions: 0, claims: 0, hints: 0, roleOfBest: {} };
  const flag = (kind, detail) => { issues[kind] = (issues[kind] || 0) + 1; (samples[kind] ||= []).length < 4 && samples[kind].push(detail); };
  for (let g = 0; g < games; g++) {
    const s = G.createGame({ points, noFlowers });
    for (let step = 0; step < 600 && s.phase !== "over"; step++) {
      if (s.phase === "draw") { G.drawTurn(s); continue; }
      if (s.phase === "act") {
        const p = s.current, opts = G.actOptions(s, p);
        if (p !== 0) {
          const a = S.botAct(s, p, opts);
          if (a.type === "tsumo") G.tsumo(s, p); else if (a.type === "kong") G.declareKong(s, p, a.k, a.kongType); else G.discard(s, p, a.id);
          continue;
        }
        stats.decisions++;
        const h = C.hint(s);
        const txt = strip(h.html);
        if (/undefined|NaN|\[object/.test(txt)) flag("text: undefined/NaN", txt);
        if (!points && /point|fan/i.test(txt)) flag("text: mentions points while points are off", txt);
        if (h.pick?.label === "Tap Win") { G.tsumo(s, 0); continue; }
        if (/every winning hand needs one/.test(txt) && !/These are equally good/.test(txt)) flag("text: 'keep' reason given for the tile to throw", txt.slice(0, 160));
        // imperfect play: sometimes throw a random tile, and check the note the coach writes about it
        if (random && Math.random() < random) {
          const hand = s.players[0].hand, rid = hand[Math.floor(Math.random() * hand.length)];
          const n = C.reviewAct(clone(s), { type: "discard", id: rid });
          if (n) {
            stats.notes = (stats.notes || 0) + 1;
            const nt = strip(n.html);
            if (/undefined|NaN|\[object/.test(nt)) flag("note text: undefined/NaN", nt);
            if (!points && /point|fan/i.test(nt)) flag("note text: mentions points while points are off", nt);
            if (/Why: \[[^\]]+\] is a pair, and every winning hand needs one/.test(nt)) flag("note text: 'keep' reason given for the better tile", nt.slice(0, 200));
            const rk = S.rankDiscards(s, 0), mk = rk.list.find((r) => r.k === E.kindOf(rid)), bk = rk.list[0];
            if (/just as close/.test(nt) && mk.shanten !== bk.shanten) flag("note: says 'just as close' but distances differ", nt.slice(0, 160));
            if (n.compare && n.compare.mine.k === n.compare.best.k) flag("note: compares a tile with itself", n.title);
            (samples["(sample notes)"] ||= []).length < 6 && samples["(sample notes)"].push(nt.slice(0, 260));
          }
          G.discard(s, 0, rid);
          continue;
        }
        const k = h.pick.k;
        // the reason given for the recommended tile
        const ranked = S.rankDiscards(s, 0);
        const lead = txt.split(" Your top choices")[0];
        const c = ranked.counts;
        const kind = c[k] >= 3 ? "set" : c[k] === 2 ? "pair" : E.isHonor(k) ? "lone-honor" : "other";
        stats.roleOfBest[kind] = (stats.roleOfBest[kind] || 0) + 1;
        if (c[k] >= 2) flag(`advice: recommends breaking a ${c[k] === 2 ? "pair" : "group of " + c[k]}`, `${T.tileName(k)} — "${lead}"`);
        // breaking your only pair (or a finished group) when another tile is just as close is never advised
        const pairCount = c.filter((x) => x >= 2).length;
        const breaks = (kk) => c[kk] >= 3 || (c[kk] === 2 && pairCount === 1);
        const sameDistOthers = ranked.list.filter((r) => r.shanten === ranked.list[0].shanten && !breaks(r.k));
        if (breaks(k) && sameDistOthers.length) flag("advice: breaks only pair/group though another tile is as close", `${T.tileName(k)}`);
        // following the coach must never earn a "that was worse" note
        const id = s.players[0].hand.find((x) => E.kindOf(x) === k);
        const before = clone(s);
        const n = C.reviewAct(before, { type: "discard", id });
        if (n) flag("contradiction: following the hint earns a note", `${T.tileName(k)} → note "${n.title}"`);
        // the hint's tile should be among the best by distance from winning
        const bestSh = ranked.list[0].shanten, mine = ranked.list.find((r) => r.k === k);
        if (mine.shanten > bestSh) flag("advice: hint is further from winning than the best", `${T.tileName(k)} ${mine.shanten} vs ${bestSh}`);
        G.discard(s, 0, id);
        continue;
      }
      if (s.phase === "claim") {
        for (const q of Object.keys(s.claim.options).map(Number)) {
          if (s.claim.responses[q]) continue;
          if (q !== 0) { G.respond(s, q, S.botClaim(s, q, s.claim.options[q])); continue; }
          stats.claims++;
          const o = s.claim.options[0];
          const h = C.hint(s);
          const txt = strip(h.html);
          if (/undefined|NaN/.test(txt)) flag("text: undefined/NaN (claim)", txt);
          if (!points && /point|fan/i.test(txt)) flag("text: mentions points while points are off (claim)", txt);
          let resp = { type: "pass" };
          if (!o.none) {
            const rec = S.recommendClaim(s, 0, o);
            const pk = rec.pick;
            resp = pk.type === "win" ? { type: "win" } : pk.type === "pass" ? { type: "pass" } : pk.type === "chow" ? { type: "chow", chow: pk.chow } : { type: pk.type };
            const label = h.pick?.label;
            const want = pk.type === "win" ? "Take it and win" : pk.type === "pass" ? "Let it go" : "Take it";
            if (label !== want) flag("contradiction: claim card label vs decision", `${label} / ${pk.type}`);
            const n = C.reviewClaim(clone(s), resp);
            if (n) flag("contradiction: following the claim hint earns a note", n.title);
          } else {
            const k = E.kindOf(s.lastDiscard.id), cnt = G.handCounts(s.players[0])[k];
            if (cnt >= 2) flag("wrong: says you can't claim but you hold two", `${T.tileName(k)} x${cnt}: ${txt}`);
            if (/You need one more/.test(txt) && cnt !== 1) flag("wrong: 'one more' count", `${cnt}: ${txt}`);
            if (/You need two more/.test(txt) && cnt !== 0) flag("wrong: 'two more' count", `${cnt}: ${txt}`);
          }
          G.respond(s, 0, resp);
        }
        G.resolveClaims(s);
      }
    }
  }
  return { games, stats, issues, samples };
}
