// Rendering and input. Drives the bots on timers, asks the coach to review each of your
// decisions, and keeps a snapshot before each one so a coach note can "take it back".
import * as G from "./game.js";
import * as St from "./strategy.js";
import * as Coach from "./coach.js";
import { kindOf, FAN_GUIDE } from "./engine.js";
import { tileHtml, backHtml, tileName, WINDS, WIND_EN } from "./tiles.js";

const KEY = "mahjong-coach:v1";
const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

let state = load() || G.createGame();
let notes = [];            // coach notes this session; `snapshot` = state before your move
let selected = null;       // tile id raised in your hand
let epoch = 0;             // bumps to cancel pending bot timers (take-back, new game)
let pane = { open: false, view: "list", id: null, hint: null };
let bubbleTimer = 0;
let lastDrawn = null;
// ?autoplay plays your seat too (with occasional deliberate mistakes) — for testing the flow.
const AUTO = new URLSearchParams(location.search).has("autoplay");

/* ---------------- persistence (this browser only) ---------------- */

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.version === 1 && s.players ? s : null;
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

/* ---------------- game loop ---------------- */

function delay() {
  const ph = state.phase;
  if (ph === "draw") return state.current === 0 ? 280 : 260;
  if (AUTO && ph !== "over") return 120;
  if (ph === "act") return state.current === 0 ? null : 720;
  if (ph === "claim") return G.claimPendingFor(state, 0) ? null : 520;
  if (AUTO && ph === "over") return 600;
  return null;
}

function schedule() {
  const my = ++epoch;
  const d = delay();
  if (d === null) return;
  setTimeout(() => { if (my === epoch) tick(); }, d);
}

function botsRespond() {
  for (const q of Object.keys(state.claim.options)) {
    if (+q !== 0 && !state.claim.responses[q]) G.respond(state, +q, St.botClaim(state, +q, state.claim.options[q]));
  }
}

function autoMove() {
  if (myTurn()) {
    const o = G.actOptions(state, 0);
    let a = St.botAct(state, 0, o);
    if (Math.random() < 0.3) { const h = state.players[0].hand; a = { type: "discard", id: h[Math.floor(Math.random() * h.length)] }; }
    if (a.type === "tsumo") return act({ type: "tsumo" });
    if (a.type === "kong") return act({ type: "kong", k: a.k, kongType: a.kongType });
    return act(a);
  }
  const o = state.claim.options[0];
  let r = St.botClaim(state, 0, o);
  if (Math.random() < 0.4) r = o.pung && Math.random() < 0.5 ? { type: "pung" } : { type: "pass" };
  return claim(r);
}

function tick() {
  const ph = state.phase;
  if (AUTO && (myTurn() || G.claimPendingFor(state, 0))) return autoMove();
  if (AUTO && ph === "over") { G.nextHand(state); return update(); }
  if (ph === "draw") G.drawTurn(state);
  else if (ph === "act" && state.current !== 0) {
    const p = state.current;
    const a = St.botAct(state, p, G.actOptions(state, p));
    if (a.type === "tsumo") G.tsumo(state, p);
    else if (a.type === "kong") G.declareKong(state, p, a.k, a.kongType);
    else G.discard(state, p, a.id);
  } else if (ph === "claim") {
    botsRespond();
    if (!G.claimPendingFor(state, 0)) G.resolveClaims(state);
  }
  update();
}

function update() {
  render();
  save();
  schedule();
}

/* ---------------- your moves ---------------- */

function myTurn() { return state.phase === "act" && state.current === 0; }

function act(action) {
  const before = clone(state);
  const n = Coach.reviewAct(before, action);
  if (action.type === "discard") G.discard(state, 0, action.id);
  else if (action.type === "tsumo") G.tsumo(state, 0);
  else if (action.type === "kong") G.declareKong(state, 0, action.k, action.kongType);
  selected = null;
  pane.hint = null;
  addNote(n, before);
  update();
}

function claim(resp) {
  if (!G.claimPendingFor(state, 0)) return;
  const before = clone(state);
  const n = Coach.reviewClaim(before, resp);
  G.respond(state, 0, resp);
  botsRespond();
  G.resolveClaims(state);
  pane.hint = null;
  addNote(n, before);
  update();
}

function addNote(n, before) {
  if (!n) return;
  n.snapshot = before;
  n.read = false;
  notes.push(n);
  showBubble(n);
  const c = $("coach");
  c.classList.remove("alert");
  void c.offsetWidth;
  c.classList.add("alert");
  if (pane.open) { pane.view = "note"; pane.id = n.id; n.read = true; }
}

function takeBack(id) {
  const i = notes.findIndex((x) => x.id === id);
  if (i < 0) return;
  const n = notes[i];
  state = clone(n.snapshot);
  notes = notes.slice(0, i);
  selected = null;
  closePane();
  hideBubble();
  update();
}

/* ---------------- rendering ---------------- */

function render() {
  renderStatus();
  for (const p of [1, 2, 3]) renderSeat(p);
  renderPools();
  renderCompass();
  renderMe();
  renderBar();
  renderCoach();
  renderPane();
  renderModal();
}

function renderStatus() {
  const me = G.seatWind(state, 0);
  $("status").innerHTML = [
    `<span class="scope">${WIND_EN[state.prevailing]} round</span>`,
    `<span class="scope">Hand ${state.handNo}</span>`,
    `<span class="scope">You're ${WIND_EN[me]}${me === 0 ? " (dealer)" : ""}</span>`,
    `<span class="scope">Min ${state.minFan} fan to win</span>`,
  ].join("");
}

function plateHtml(p) {
  const pl = state.players[p];
  const sw = G.seatWind(state, p);
  const on = state.current === p && (state.phase === "act" || state.phase === "draw");
  const thinking = on && p !== 0;
  return `<div class="plate ${on ? "on" : ""} ${thinking ? "thinking" : ""}">
    <span class="wind ${sw === 0 ? "dealer" : ""}" title="${WIND_EN[sw]} seat${sw === 0 ? ", dealer" : ""}">${WINDS[sw]}</span>
    <span class="nm">${pl.name}</span>
    <span class="pts">${pl.score}</span>
  </div>`;
}

function meldsHtml(pl, size) {
  const melds = pl.melds.map((m) => {
    const tiles = m.tiles.map((id, i) => {
      const k = kindOf(id);
      const hidden = m.concealed && (i === 0 || i === 3);
      return tileHtml(k, { size, cls: `${hidden ? "face-down" : ""} ${id === m.claimed ? "claimed" : ""}` });
    });
    return `<span class="meld" title="${m.concealed ? "Concealed kong" : m.type}">${tiles.join("")}</span>`;
  });
  const fl = pl.flowers.length ? `<span class="flowers">${pl.flowers.map((id) => tileHtml(kindOf(id), { size })).join("")}</span>` : "";
  return melds.join("") + fl;
}

function renderSeat(p) {
  const pl = state.players[p];
  const el = document.querySelector(`.seat[data-p="${p}"]`);
  const backs = Array.from({ length: pl.hand.length }, () => backHtml("xs")).join("");
  el.innerHTML = `${plateHtml(p)}<div class="backs" title="${pl.hand.length} tiles">${backs}</div><div class="exposed">${meldsHtml(pl, "xs")}</div>`;
}

// discards already on screen, so only a newly thrown tile plays the drop-in animation
const shownDiscards = new Set();
let shownHand = 0;

function renderPools() {
  if (shownHand !== state.handNo) {
    // new hand, page load or take-back: whatever is already on the table just appears
    shownDiscards.clear();
    shownHand = state.handNo;
    state.players.forEach((pl) => pl.discards.forEach((d) => shownDiscards.add(d.id)));
  }
  const ld = state.lastDiscard;
  for (let p = 0; p < 4; p++) {
    const el = document.querySelector(`.pool[data-p="${p}"]`);
    const ds = state.players[p].discards.filter((d) => !d.taken);
    el.innerHTML = ds.map((d) => {
      const last = ld && ld.id === d.id && !ld.robbing;
      const fresh = !shownDiscards.has(d.id);
      shownDiscards.add(d.id);
      return tileHtml(kindOf(d.id), { size: "sm", cls: `${last ? "last" : ""} ${fresh ? "fresh" : ""}` });
    }).join("");
  }
}

function renderCompass() {
  $("compass").innerHTML = `<div class="big" title="${WIND_EN[state.prevailing]} round">${WINDS[state.prevailing]}</div><small>${G.liveTiles(state)} tiles left</small>`;
}

function renderMe() {
  const pl = state.players[0];
  $("mePlate").innerHTML = plateHtml(0);
  $("meExposed").innerHTML = meldsHtml(pl, "md");
  const live = myTurn();
  const hand = pl.hand.slice();
  const drawn = state.drawn !== null && state.current === 0 && hand.includes(state.drawn) ? state.drawn : null;
  const rest = hand.filter((id) => id !== drawn).sort((a, b) => kindOf(a) - kindOf(b) || a - b);
  const ids = drawn !== null ? [...rest, drawn] : rest;
  if (selected !== null && !ids.includes(selected)) selected = null;
  const isNew = drawn !== null && drawn !== lastDrawn;
  lastDrawn = drawn;
  const el = $("hand");
  el.classList.toggle("live", live);
  el.innerHTML = ids.map((id) => tileHtml(kindOf(id), {
    size: "lg", id, button: true,
    cls: `${id === selected ? "sel" : ""} ${id === drawn ? "drawn" : ""} ${id === drawn && isNew ? "new" : ""}`,
  })).join("");
  el.querySelectorAll(".tile").forEach((b) => { b.disabled = !live; b.setAttribute("aria-pressed", String(b.dataset.id == selected)); });
}

function renderBar() {
  const bar = $("bar");
  const parts = [];
  if (myTurn()) {
    const o = G.actOptions(state, 0);
    if (o.tsumo && o.tsumo.legal) parts.push(`<button type="button" class="btn red" data-act="tsumo">Win · ${o.tsumo.fan} fan</button>`);
    for (const kg of o.kongs) parts.push(`<button type="button" class="btn light small" data-act="kong" data-k="${kg.k}" data-type="${kg.type}">Kong ${tileHtml(kg.k, { size: "xs", title: false })}</button>`);
    if (selected !== null) parts.push(`<button type="button" class="btn" data-act="discard">Discard ${tileHtml(kindOf(selected), { size: "xs", title: false })}</button>`);
    const say = state.afterClaim ? "Now discard a tile." : selected !== null ? "Tap it again, or press Discard." : o.tsumo && !o.tsumo.legal ? `Your hand is complete but scores ${o.tsumo.fan} fan; you need ${state.minFan}. Keep going.` : "Your turn. Tap a tile to pick your discard.";
    parts.unshift(`<div class="say">${say}</div>`);
  } else if (G.claimPendingFor(state, 0)) {
    const ld = state.lastDiscard;
    const o = state.claim.options[0];
    const k = kindOf(ld.id);
    const who = state.players[ld.from].name;
    parts.push(`<div class="say"><b>${who}</b> ${ld.robbing ? "is adding to a kong with" : "discarded"} ${tileHtml(k, { size: "xs" })}. Claim it?</div>`);
    if (o.win) parts.push(`<button type="button" class="btn red" data-claim="win">Win · ${o.win.fan} fan</button>`);
    if (o.kong) parts.push(`<button type="button" class="btn" data-claim="kong">Kong</button>`);
    if (o.pung) parts.push(`<button type="button" class="btn" data-claim="pung">Pung</button>`);
    o.chows.forEach((ch, i) => {
      const ks = [...ch, k].sort((a, b) => a - b);
      parts.push(`<button type="button" class="btn" data-claim="chow" data-i="${i}">Chow ${ks.map((x) => tileHtml(x, { size: "xs", title: false })).join("")}</button>`);
    });
    parts.push(`<button type="button" class="btn light" data-claim="pass">Pass</button>`);
  } else if (state.phase === "claim") {
    const ld = state.lastDiscard;
    parts.push(`<div class="say">${ld.from === 0 ? "You" : state.players[ld.from].name} discarded ${tileHtml(kindOf(ld.id), { size: "xs" })}</div>`);
  } else if (state.phase !== "over") {
    const p = state.current;
    parts.push(`<div class="say">${p === 0 ? "Drawing…" : `${state.players[p].name}'s turn`}</div>`);
  }
  bar.innerHTML = parts.join("");
}

/* ---------------- coach chathead + pane ---------------- */

function unread() { return notes.filter((n) => !n.read).length; }

function renderCoach() {
  const b = $("coachBadge");
  const u = unread();
  b.hidden = !u;
  b.textContent = u;
  $("coach").setAttribute("aria-label", u ? `Coach: ${u} new note${u > 1 ? "s" : ""}` : "Open coach");
}

function showBubble(n) {
  const b = $("bubble");
  b.textContent = n.bubble;
  b.dataset.id = n.id;
  b.hidden = false;
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, 6000);
}
function hideBubble() { $("bubble").hidden = true; }

function openNote(id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return openList();
  n.read = true;
  pane = { ...pane, open: true, view: "note", id };
  hideBubble();
  render();
}
function openList() {
  pane = { ...pane, open: true, view: "list", id: null };
  hideBubble();
  render();
}
function closePane() { pane.open = false; render(); }

function renderPane() {
  const el = $("pane");
  el.classList.toggle("open", pane.open);
  el.setAttribute("aria-hidden", String(!pane.open));
  $("paneBack").hidden = pane.view !== "note";
  if (!pane.open) return;
  const body = $("paneBody");
  if (pane.view === "note") {
    const n = notes.find((x) => x.id === pane.id);
    if (!n) { pane.view = "list"; return renderPane(); }
    const cmp = n.compare ? `<div class="compare">
      <div class="compare-card mine"><span class="lbl">${n.compare.mine.label}</span>${tileHtml(n.compare.mine.k, { size: "md" })}<span class="sub">${n.compare.mine.sub || tileName(n.compare.mine.k)}</span></div>
      <div class="compare-card best"><span class="lbl">${n.compare.best.label}</span>${tileHtml(n.compare.best.k, { size: "md" })}<span class="sub">${n.compare.best.sub || tileName(n.compare.best.k)}</span></div>
    </div>` : "";
    const canUndo = n.snapshot && n.handNo === state.handNo;
    body.innerHTML = `<h3>${n.title}</h3>${cmp}${n.html}
      <div class="pane-actions">
        ${canUndo ? `<button type="button" class="btn" data-undo="${n.id}">Take it back</button>` : ""}
        <button type="button" class="btn light" data-close>Got it</button>
      </div>`;
    return;
  }
  const yourMove = myTurn() || G.claimPendingFor(state, 0);
  const list = notes.slice().reverse().map((n) => `<li><button type="button" class="note-row" data-note="${n.id}">
      <span class="dot ${n.read ? "read" : ""}"></span><span><b>${n.title}</b><small>Hand ${n.handNo}</small></span></button></li>`).join("");
  const hintBox = pane.hint ? `<div class="hint-box"><h4>${pane.hint.title}</h4>${pane.hint.html}</div>` : "";
  body.innerHTML = `<h3>Hi, I'm your coach</h3>
    <p>Play your game. When there was a clearly better move, I'll nudge you here and explain why. You can take the move back and try again.</p>
    <button type="button" class="btn ${yourMove ? "" : "light"}" data-hint ${yourMove ? "" : "disabled"}>${yourMove ? "What would you do?" : "Ask me on your turn"}</button>
    ${hintBox}
    <p class="section-label">Notes</p>
    ${notes.length ? `<ul class="notes">${list}</ul>` : `<p class="empty">Nothing yet. Nice playing so far.</p>`}`;
}

/* ---------------- modals ---------------- */

let guideOpen = false;

function renderModal() {
  const m = $("modal");
  const card = $("modalCard");
  if (guideOpen) {
    m.hidden = false;
    card.innerHTML = guideHtml();
    return;
  }
  if (state.phase !== "over") { m.hidden = true; return; }
  m.hidden = false;
  card.innerHTML = resultHtml();
}

function handGroups(p, arr) {
  const pl = state.players[p];
  const groups = pl.melds.map((m) => m.tiles.map(kindOf));
  if (arr && !arr.special) {
    for (const s of arr.sets) groups.push(s.type === "pung" ? [s.k, s.k, s.k] : [s.k, s.k + 1, s.k + 2]);
    groups.push([arr.pair, arr.pair]);
  } else {
    groups.push(pl.hand.map(kindOf).sort((a, b) => a - b));
  }
  if (pl.flowers.length) groups.push(pl.flowers.map(kindOf));
  return `<div class="groups">${groups.map((g) => `<span class="group">${g.map((k) => tileHtml(k, { size: "sm" })).join("")}</span>`).join("")}</div>`;
}

function resultHtml() {
  const r = state.result;
  let head, lede, body = "";
  if (r.type === "draw") {
    head = "It's a draw";
    lede = "The wall ran out before anyone won. The dealer keeps the deal.";
  } else {
    const w = state.players[r.winner];
    head = r.winner === 0 ? "You won!" : `${w.name} won`;
    const how = r.selfDraw ? "Self-drawn" : `Off ${r.from === 0 ? "your" : state.players[r.from].name + "'s"} discard`;
    lede = `${how} · ${r.fan} fan · ${r.selfDraw ? `${r.points} from each player` : `${r.points * 2} from ${r.from === 0 ? "you" : state.players[r.from].name}`}`;
    body = handGroups(r.winner, r.arrangement) +
      `<ul class="fan-list">${r.items.map(([n, f]) => `<li><span>${n}</span><span>${f}</span></li>`).join("")}<li class="total"><span>Total${r.fan === 13 ? " (limit)" : ""}</span><span>${r.fan} fan</span></li></ul>`;
  }
  const delta = r.delta || [0, 0, 0, 0];
  const scores = state.players.map((pl, i) => `<div class="score-cell"><b>${pl.name}</b><span>${pl.score}</span>
    <em class="${delta[i] > 0 ? "up" : delta[i] < 0 ? "down" : ""}">${delta[i] > 0 ? "+" : ""}${delta[i] || "–"}</em></div>`).join("");
  const handNotes = notes.filter((n) => n.handNo === state.handNo).length;
  const coachLine = handNotes ? `<p class="lede" style="margin:20px 0 0">Your coach left ${handNotes} note${handNotes > 1 ? "s" : ""} this hand.</p>` : "";
  return `<h2>${head}</h2><p class="lede">${lede}</p>${body}<div class="scores">${scores}</div>${coachLine}
    <div class="btns">
      ${handNotes ? `<button type="button" class="btn light" data-open-coach>Review notes</button>` : ""}
      <button type="button" class="btn" data-next>Next hand</button>
    </div>`;
}

function guideHtml() {
  const rows = FAN_GUIDE.map(([n, f, d]) => `<li><b>${n}</b><span>${f === 13 ? "Limit" : f + " fan"}</span><small>${d}</small></li>`).join("");
  return `<h2>How to play</h2>
    <div class="basics">
      <p>Make a hand of <b>four sets and a pair</b> (14 tiles). A set is a <b>chow</b> (three in a row in one suit), a <b>pung</b> (three of a kind) or a <b>kong</b> (four of a kind, which earns you a replacement tile).</p>
      <p>Each turn you draw, then discard. Anyone can claim a discard for a pung, kong or win; only the next player can claim it for a chow. A win beats a pung, and a pung beats a chow.</p>
      <p>Flowers and seasons are set aside and replaced automatically. A winning hand needs at least <b>${state.minFan} fan</b>.</p>
      <p>Scoring: on a self-drawn win each player pays the table value; on a discard the discarder pays double. Values are 1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128… for 0, 1, 2, 3… fan.</p>
    </div>
    <h4>Fan</h4>
    <ul class="guide">${rows}</ul>
    <div class="btns"><button type="button" class="btn" data-close-guide>Back to the table</button></div>`;
}

/* ---------------- events ---------------- */

$("hand").addEventListener("click", (e) => {
  const b = e.target.closest(".tile");
  if (!b || !myTurn()) return;
  const id = +b.dataset.id;
  if (selected === id) act({ type: "discard", id });
  else { selected = id; render(); }
});
$("hand").addEventListener("dblclick", (e) => {
  const b = e.target.closest(".tile");
  if (b && myTurn() && state.players[0].hand.includes(+b.dataset.id) && selected !== +b.dataset.id) act({ type: "discard", id: +b.dataset.id });
});

$("bar").addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (a && myTurn()) {
    if (a.dataset.act === "discard" && selected !== null) act({ type: "discard", id: selected });
    if (a.dataset.act === "tsumo") act({ type: "tsumo" });
    if (a.dataset.act === "kong") act({ type: "kong", k: +a.dataset.k, kongType: a.dataset.type });
    return;
  }
  const c = e.target.closest("[data-claim]");
  if (c) {
    const type = c.dataset.claim;
    if (type === "chow") claim({ type, chow: state.claim.options[0].chows[+c.dataset.i] });
    else claim({ type });
  }
});

$("coach").addEventListener("click", () => {
  if (pane.open) return closePane();
  const fresh = notes.filter((n) => !n.read);
  if (fresh.length) openNote(fresh[fresh.length - 1].id);
  else openList();
});
$("bubble").addEventListener("click", () => openNote(+$("bubble").dataset.id));
$("paneClose").addEventListener("click", closePane);
$("paneBack").addEventListener("click", openList);
$("paneBody").addEventListener("click", (e) => {
  const u = e.target.closest("[data-undo]");
  if (u) return takeBack(+u.dataset.undo);
  if (e.target.closest("[data-close]")) return closePane();
  const nr = e.target.closest("[data-note]");
  if (nr) return openNote(+nr.dataset.note);
  if (e.target.closest("[data-hint]")) { pane.hint = Coach.hint(state); render(); }
});

$("modal").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-guide]") || (guideOpen && e.target === $("modal"))) { guideOpen = false; render(); return; }
  if (e.target.closest("[data-open-coach]")) { openList(); return; }
  if (e.target.closest("[data-next]")) {
    const roundDone = G.nextHand(state);
    selected = null;
    if (roundDone) {
      showBubble({ id: 0, bubble: `On to the ${WIND_EN[state.prevailing]} round.` });
    }
    update();
  }
});

$("guideBtn").addEventListener("click", () => { guideOpen = true; render(); });
$("newBtn").addEventListener("click", () => {
  if (!confirm("Start a new game? Scores go back to zero.")) return;
  state = G.createGame();
  notes = [];
  selected = null;
  closePane();
  update();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (guideOpen) { guideOpen = false; render(); }
    else if (pane.open) closePane();
  }
});

if (AUTO) window.__mc = { tick, get state() { return state; }, get notes() { return notes; } };

update();
