// Rendering and input. Drives the bots on timers, asks the coach to review each of your
// decisions, and keeps a snapshot before each one so a coach note can "take it back".
import * as G from "./game.js";
import * as St from "./strategy.js";
import * as Coach from "./coach.js";
import { kindOf, FAN_GUIDE, isSuited } from "./engine.js";
import { coachTileHtml, coachPortraitHtml } from "./coach-art.js";
import { dealAnimation, introDeal } from "./deal-anim.js";
import { setSoundEnabled } from "./sound.js";
import { tileConfetti } from "./confetti.js";
import { setLang, zh, term, callChar, localize } from "./lang.js";
import { swipeToClose } from "./swipe.js";
import { tileHtml, backHtml, tileName, WINDS, WIND_EN } from "./tiles.js";

// ?autoplay and ?sandbox are for testing: they save to their own slot so your real game is untouched.
const QS = new URLSearchParams(location.search);
const TEST = QS.has("autoplay") || QS.has("sandbox");
const KEY = TEST ? "mahjong-coach:test" : "mahjong-coach:v1";
const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

const PREFS = TEST ? "mahjong-coach:test-prefs" : "mahjong-coach:prefs";
// noFlowers: play without the flower and season tiles (on by default; applies from the next hand dealt)
const prefs = { showScores: false, autoSort: true, showClaimed: false, difficulty: "normal", sound: true, noFlowers: true, lang: "mandarin", ...loadPrefs() };
setLang(prefs.lang);
const firstVisit = !load();  // no saved game: start with the face-down pile and a "Start new game" button
let state = load() || G.createGame({ noFlowers: prefs.noFlowers, points: prefs.showScores });
state.points = prefs.showScores;  // Scores on = playing with points (a win needs points); off = any complete hand wins
G.refreshNames(state);
let notes = [];            // coach notes this session; `snapshot` = state before your move
let history = [];          // Undo: { state, notes } before each of your moves this hand, latest last
let selected = null;       // tile id raised in your hand
let dealing = false;       // the shuffle-and-deal animation is playing: nothing else moves
let announce = null;       // a bot just called a peng / chow / kong: shown in the white box until you press Continue
let epoch = 0;             // bumps to cancel pending bot timers (take-back, new game)
let pane = { open: false, view: "list", id: null, hint: null };
let bubbleTimer = 0;
let lastDrawn = null;
let nudge = null;          // { id, html }: why a call you tried isn't possible (cleared on the next discard)
let callPick = [];         // tiles you've tapped from your hand to call the discard with
// Your own tile order when Autosort is off (tile ids, left to right). Saved per browser.
const ORDER = TEST ? "mahjong-coach:test-order" : "mahjong-coach:order";
let myOrder = (() => { try { return JSON.parse(localStorage.getItem(ORDER)) || []; } catch { return []; } })();
function saveOrder() { try { localStorage.setItem(ORDER, JSON.stringify(myOrder)); } catch { /* storage unavailable */ } }
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } }
function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* storage unavailable */ } }
// ?autoplay plays your seat too (with occasional deliberate mistakes) — for testing the flow.
const AUTO = QS.has("autoplay");

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

/* A winning tile (drawn, or thrown by someone) wins for you straight away: no Mahjong button to press. */
function canAutoWin() {
  if (myTurn()) { const o = G.actOptions(state, 0); return !!(o.tsumo && o.tsumo.legal); }
  return G.claimPendingFor(state, 0) && !!state.claim.options[0].win;
}
function autoWin() {
  if (myTurn()) act({ type: "tsumo" }); else claim({ type: "win" });
  celebrateSoon(celebrate);
}
/* The confetti comes a beat after the win, once the winning hand has settled on screen (and not at all if
   the hand has moved on by then, say New game was pressed). */
const CONFETTI_DELAY = 600;
function celebrateSoon(burst) {
  const hand = state.handNo;
  setTimeout(() => {
    const r = state.result;
    if (state.handNo === hand && state.phase === "over" && r && r.type !== "draw" && r.winner === 0) burst();
  }, CONFETTI_DELAY);
}
/* Your win: tiles from your winning hand burst out of the winning tile (the big one in the white box). */
function celebrate() {
  const el = document.querySelector("#bar .inplay .tile") || document.querySelector("#hand .won-tile");
  const me = state.players[0];
  tileConfetti(el ? el.getBoundingClientRect() : null, [...me.hand.map(kindOf), ...me.melds.flatMap((m) => m.tiles.map(kindOf))]);
}

function delay() {
  const ph = state.phase;
  if (!AUTO && canAutoWin()) return 450;  // a moment to see the tile arrive, then the win
  if (ph === "draw") return state.current === 0 ? 280 : 260;
  if (AUTO && ph !== "over") return 120;
  if (ph === "act") return state.current === 0 ? null : 720;
  if (ph === "claim") return G.claimPendingFor(state, 0) ? null : 1000;
  if (AUTO && ph === "over") return 600;
  return null;
}

function schedule() {
  if (dealing || announce) return;  // nothing moves while a hand is dealt, or until you've seen another player's call
  const my = ++epoch;
  const d = delay();
  if (d === null) return;
  setTimeout(() => { if (my === epoch) tick(); }, d);
}

function botsRespond() {
  for (const q of Object.keys(state.claim.options)) {
    if (+q !== 0 && !state.claim.responses[q]) G.respond(state, +q, St.botClaim(state, +q, state.claim.options[q], prefs.difficulty));
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
  if (AUTO && ph === "over") { (state.noFlowers = prefs.noFlowers, G.nextHand(state)); return update(); }
  if (canAutoWin()) return autoWin();
  if (ph === "draw") G.drawTurn(state);
  else if (ph === "act" && state.current !== 0) {
    const p = state.current;
    const a = St.botAct(state, p, G.actOptions(state, p), prefs.difficulty);
    if (a.type === "tsumo") G.tsumo(state, p);
    else if (a.type === "kong") G.declareKong(state, p, a.k, a.kongType);
    else G.discard(state, p, a.id);
  } else if (ph === "claim") {
    botsRespond();
    if (!G.claimPendingFor(state, 0)) resolveClaims();
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
  remember(before, action.type !== "tsumo");
  const n = Coach.reviewAct(before, action);
  if (action.type === "discard") G.discard(state, 0, action.id);
  else if (action.type === "tsumo") G.tsumo(state, 0);
  else if (action.type === "kong") G.declareKong(state, 0, action.k, action.kongType);
  selected = null;
  nudge = null;
  pane.hint = null;
  addNote(n, before);
  update();
}

/* Resolve the open claim; if another player called a set, keep it on screen until you press Continue. */
function resolveClaims() {
  const before = state.players.map((pl) => pl.melds.length);
  const from = state.lastDiscard?.from;
  G.resolveClaims(state);
  if (AUTO) return;
  for (const q of [1, 2, 3]) {
    if (state.players[q].melds.length > before[q]) {
      const m = state.players[q].melds[state.players[q].melds.length - 1];
      announce = { q, type: m.type, k: kindOf(m.claimed), from, tiles: m.tiles.map(kindOf) };
    }
  }
}

function claim(resp) {
  if (!G.claimPendingFor(state, 0)) return;
  const before = clone(state);
  remember(before, resp.type !== "win");
  const n = Coach.reviewClaim(before, resp);
  nudge = null;
  callPick = [];
  G.respond(state, 0, resp);
  botsRespond();
  resolveClaims();
  pane.hint = null;
  addNote(n, before);
  update();
}

/* Calling is up to you: nothing tells you a peng, chow or kong is possible. Tap tiles in your hand to lift
   them and Continue turns into Call. If it isn't a real call, a short line says why. Mahjong only appears
   when you can actually win. */
const nudgeKey = () => `${state.handNo}:${state.phase}:${state.current}:${state.lastDiscard?.id ?? ""}:${state.wall.length}`;
function say(html) { nudge = { key: nudgeKey(), html }; render(); }
const tx = (k) => tileHtml(k, { size: "xs" });
// a curved arrow turning back, for Undo and Take it back
const UNDO_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`;

function callPicked() {
  const ld = state.lastDiscard;
  const o = state.claim.options[0];
  const k = kindOf(ld.id);
  const ks = callPick.map(kindOf).sort((a, b) => a - b);
  if (ks.length < 2) return say(`A call needs two tiles from your hand to go with ${tx(k)} (three for a kong). Tap one more.`);
  const same = ks.every((x) => x === k);
  if (same && ks.length === 2) return o.pung ? claim({ type: "pung" }) : say(`You can't peng this tile.`);
  if (same && ks.length === 3) return o.kong ? claim({ type: "kong" }) : say(`There are no tiles left to replace a kong with, so you can't kong now. Pick two for a peng instead.`);
  const run = [...ks, k].sort((a, b) => a - b);
  const isRun = ks.length === 2 && run.every((x) => x < 27 && Math.floor(x / 9) === Math.floor(k / 9)) && run[1] === run[0] + 1 && run[2] === run[1] + 1;
  if (!isRun) {
    if (ks.length === 2 && !isSuited(k)) return say(`Winds and dragons can't make a run. Pick two ${tx(k)} for a peng.`);
    return say(`Those don't make a set with ${tx(k)}. A peng is two more ${tx(k)}${isSuited(k) ? `; a chow is two tiles that run with it, like ${runExample(k)}` : ""}.`);
  }
  if (ld.from !== 3) return say(`That's a chow, and you can only chow the player right before you (${state.players[3].name}). From ${state.players[ld.from].name} you can only peng (three of a kind), kong (four of a kind) or win.`);
  return claim({ type: "chow", chow: ks });
}
/* The call button is named after the set your lifted tiles make with the discard: Peng (two more of it),
   Kong (three more) or Chow (two that run with it). Anything else, or just one tile so far, stays "Call". */
function callLabel() {
  const k = kindOf(state.lastDiscard.id);
  const ks = callPick.map(kindOf).sort((a, b) => a - b);
  // each with its Chinese character, in the tiles' brush font, and its name in the chosen language:
  // 碰 Pèng, 杠 Gàng, 吃 Chī (Mandarin) or 碰 Pung, 槓 Kong, 吃 Chow (Cantonese)
  const label = (t) => `<span class="call-zh">${callChar(t)}</span>${term(t, true)}`;
  if (ks.length >= 2 && ks.every((x) => x === k)) return ks.length === 2 ? label("peng") : label("kong");
  if (ks.length === 2 && isSuited(k)) {
    const run = [...ks, k].sort((a, b) => a - b);
    if (run.every((x) => Math.floor(x / 9) === Math.floor(k / 9)) && run[1] === run[0] + 1 && run[2] === run[1] + 1) return label("chow");
  }
  return "Call";
}
function mahjongOnDiscard() {
  if (!state.claim.options[0].win) return;
  const burst = celebrateFrom(kindOf(state.lastDiscard.id));
  claim({ type: "win" });
  celebrateSoon(burst);
}
function mahjongOnTurn(from = null) {
  const o = G.actOptions(state, 0);
  if (!(o.tsumo && o.tsumo.legal)) return;
  const burst = celebrateFrom(null, from);
  act({ type: "tsumo" });
  celebrateSoon(burst);
}
/* Your win: tiles from your hand burst out of the Mahjong button as confetti. Where the button is has to be
   measured before the win re-renders the bar, so this measures first and returns the burst to fire after. */
function celebrateFrom(extra = null, from = null) {
  const btn = from || document.querySelector("#bar .btn.red");
  const rect = btn ? btn.getBoundingClientRect() : null;
  const me = state.players[0];
  const kinds = [...me.hand.map(kindOf), ...me.melds.flatMap((m) => m.tiles.map(kindOf)), ...(extra !== null ? [extra] : [])];
  return () => tileConfetti(rect, kinds);
}
function runExample(k) {
  const n = k % 9;
  const pair = n <= 6 ? [k + 1, k + 2] : [k - 2, k - 1];
  return pair.map((x) => tileHtml(x, { size: "xs" })).join("");
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

/* Undo: the state before each of your moves this hand (and how many coach notes there were then). A win isn't
   kept as a step, so Undo never takes back a win. */
function remember(before, undoable) {
  if (undoable) history.push({ state: before, notes: notes.length });
}
function undo() {
  const h = history.pop();
  if (!h || dealing) return;
  epoch++;  // cancel any bot move still waiting
  state = clone(h.state);
  notes = notes.slice(0, h.notes);
  announce = null; selected = null; callPick = []; nudge = null; pane.hint = null;
  resultClosed = false; resultAsked = false;
  hideBubble();
  update();
}

function takeBack(id) {
  announce = null;
  const i = notes.findIndex((x) => x.id === id);
  if (i < 0) return;
  const n = notes[i];
  // Undo steps from this move on are gone too
  const hi = history.findIndex((h) => h.state === n.snapshot);
  if (hi >= 0) history = history.slice(0, hi);
  epoch++;
  state = clone(n.snapshot);
  notes = notes.slice(0, i);
  selected = null;
  closePane();
  hideBubble();
  update();
}

/* ---------------- rendering ---------------- */

// Default: the latest move stacked and centered. If that would push your "You" label below the bottom of the
// window, use the compact one-row version instead (72px shorter). Checked after every render and on resize.
const PHONE = window.matchMedia("(max-width: 600px)");
// phones held sideways: everything on one screen (see the matching block at the end of style.css)
const LANDSCAPE = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (min-width: 601px)");
LANDSCAPE.addEventListener("change", () => render());
let sheetMinH = 0;
// a new screen size starts the steady height over
window.addEventListener("resize", () => { sheetMinH = 0; $("sheet").style.minHeight = ""; if (PHONE.matches) placeSheet(); });
function placeSheet() {
  const sheet = $("sheet"), bar = $("bar"), me = $("me"), plate = $("mePlate"), felt = document.querySelector(".felt"), center = document.querySelector(".center");
  if (PHONE.matches) {
    if (bar.parentElement !== sheet) { sheet.prepend(bar); sheet.append(me); }
    if (plate.parentElement !== sheet) sheet.prepend(plate);  // "You" label sits at the top of the sheet
    // Steady height: the sheet never shrinks back between turns. If a turn needs more room (a longer
    // prompt, extra called sets) it grows once and stays at that height, so the floating buttons don't bob.
    if (sheet.offsetHeight > sheetMinH) { sheetMinH = sheet.offsetHeight; sheet.style.minHeight = `${sheetMinH}px`; }
    // the sheet's full height (even while tucked away): the coach's sheet is at least this tall, so it covers it
    document.documentElement.style.setProperty("--sheet-full", `${sheet.offsetHeight}px`);
    // While the sheet is open the page doesn't scroll, so the table (every player's tiles) always stays in view;
    // to see what's behind the sheet, collapse it. Collapsed, the page scrolls if the table is still too tall.
    const open = !sheet.classList.contains("collapsed");
    document.documentElement.classList.toggle("lock-scroll", open);
    if (open && scrollY) scrollTo(0, 0);
    if (!open) {
      // collapsed: show down to just below your row of tiles (which now sits right under the compass)
      const peek = Math.round(me.offsetTop + me.offsetHeight + 16);
      sheet.style.setProperty("--sheet-peek", `${peek}px`);
      document.documentElement.style.setProperty("--sheet-h", `${peek}px`);
    } else {
      sheet.style.removeProperty("--sheet-peek");
      document.documentElement.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`);
    }
  } else if (bar.parentElement === sheet) {
    document.documentElement.classList.remove("lock-scroll");
    felt.append(bar);
    center.append(me);
    me.append(plate);
  }
}
PHONE.addEventListener("change", () => render());

/* Bottom sheet grabber: tap to collapse/expand, or drag it down/up. */
function setSheet(collapsed) {
  const sheet = $("sheet");
  sheet.classList.toggle("collapsed", collapsed);
  $("sheetGrab").setAttribute("aria-expanded", String(!collapsed));
  $("sheetGrab").setAttribute("aria-label", collapsed ? "Show your hand" : "Collapse your hand");
  placeSheet();
}
{
  const grab = $("sheetGrab");
  let y0 = null, moved = false;
  grab.addEventListener("pointerdown", (e) => { y0 = e.clientY; moved = false; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0;
    if (Math.abs(dy) > 24) { moved = true; setSheet(dy > 0); y0 = null; }
  });
  grab.addEventListener("pointerup", () => { y0 = null; });
  grab.addEventListener("click", () => { if (!moved) setSheet(!$("sheet").classList.contains("collapsed")); moved = false; });
  // a tap anywhere on the collapsed sheet (its compass or your tiles) opens it again
  $("sheet").addEventListener("click", (e) => {
    if (e.target.closest("#sheetGrab") || !$("sheet").classList.contains("collapsed")) return;
    setSheet(false);
  });
}

const DEPTH = 0.13;  // matches --depth in style.css: a tile's 3D edge as a share of its width
function fitLayout() {
  const bar = $("bar"), hand = $("hand"), center = document.querySelector(".center");
  if (!bar || !hand) return;
  try { fitLayoutInner(bar, hand, center); } finally { markPlateOverTiles(); }
}
/* Desktop: the floating "You" label gets its pill only when it sits over your tiles (or called sets). */
function markPlateOverTiles() {
  const plate = $("mePlate");
  if (!plate) return;
  if (PHONE.matches || LANDSCAPE.matches) { plate.classList.remove("on-tiles"); return; }
  plate.classList.remove("on-tiles");
  const p = plate.getBoundingClientRect();
  const over = [...document.querySelectorAll("#hand .tile, #meExposed .tile")].some((t) => {
    const r = t.getBoundingClientRect();
    const bottom = r.bottom + r.width * DEPTH + 1;  // include the tile's 3D edge
    return r.left < p.right && r.right > p.left && r.top < p.bottom && bottom > p.top;
  });
  plate.classList.toggle("on-tiles", over);
}
function fitLayoutInner(bar, hand, center) {
  bar.classList.remove("compact");  // measure with the centred, stacked layout
  center?.style.removeProperty("--lg-max");
  if (PHONE.matches) return;  // phones: always stacked, in the sheet
  // sideways: your hand is pinned to the bottom and the box has a set height; stacked and centred if it fits, else one row
  if (LANDSCAPE.matches) { if (bar.scrollHeight > bar.clientHeight + 1) bar.classList.add("compact"); return; }
  // The floating buttons along the bottom (New game, Settings, You, Coach) may cover at most 20% of your tiles
  // (their height including the 3D edge), measured with the page scrolled to the top.
  const buttonsTop = Math.min(...[".fab", "#mePlate", "#coach"].map((sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? innerHeight), innerHeight);
  const fits = () => {
    const rects = [...hand.querySelectorAll(".tile")].map((t) => t.getBoundingClientRect());
    if (!rects.length) return true;
    const h = rects[0].height + rects[0].width * DEPTH + 1;
    const bottom = Math.max(...rects.map((r) => r.bottom + r.width * DEPTH + 1)) + window.scrollY;
    return Math.round(bottom - buttonsTop) <= h * 0.2;
  };
  // 1. keep the centred, stacked box if that fits; 2. otherwise the shorter left/right box;
  // 3. if even that is too tall, shrink the tiles a little at a time until it fits
  if (fits()) return;
  bar.classList.add("compact");
  if (fits()) return;
  let w = hand.querySelector(".tile")?.getBoundingClientRect().width ?? 56;
  while (w > 36 && !fits()) { w -= 2; center.style.setProperty("--lg-max", `${w}px`); }
  // a very short window where even 36px tiles don't clear the buttons: keep full-size tiles (scroll to see them)
  if (!fits()) center.style.removeProperty("--lg-max");
}
window.addEventListener("resize", () => fitLayout());
// the "You" label is fixed, so scrolling can move your tiles under it (or out from under it)
window.addEventListener("scroll", () => markPlateOverTiles(), { passive: true });

function render() {
  if (state.phase === "over" && state.result && state.result !== heldResult) {
    heldResult = state.result;
    if (state.result.type === "draw" || state.result.winner !== 0) {
      resultHeld = true;
      setTimeout(() => { resultHeld = false; render(); }, RESULT_HOLD);
    }
  }
  // where the tile(s) in the white box sit right now: a discard that leaves the box flies from there
  const boxRects = new Map([...document.querySelectorAll("#bar [data-fly-id]")].map((e) => [+e.dataset.flyId, e.getBoundingClientRect()]));
  freshDiscards = [];
  renderStatus();
  renderSettings();
  for (const p of [1, 2, 3]) renderSeat(p);
  renderPools();
  renderMe();
  renderBar();
  renderCoach();
  renderPane();
  renderModal();
  placeSheet();
  fitLayout();
  flyDiscards(boxRects);
}

/* A new discard flies into the discard pile: from the white box if it was showing there (your discard, or one
   you just passed on), otherwise from the player who threw it. The tile in the pile stays hidden until it lands. */
let freshDiscards = [];  // [{ id, from }] added to the pile in this render
function flyDiscards(boxRects) {
  if (!freshDiscards.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const { id, from } of freshDiscards) {
    const target = document.querySelector(`#discards [data-tile-id~="${id}"] .tile, #discards .tile[data-tile-id="${id}"]`);
    if (!target) continue;
    const to = target.getBoundingClientRect();
    let src = boxRects.get(id);
    if (!src || !src.width) {
      const seat = from === 0 ? $("hand") : document.querySelector(`.seat[data-p="${from}"] .line`) || document.querySelector(`.seat[data-p="${from}"]`);
      if (!seat) continue;
      const r = seat.getBoundingClientRect();
      if (!r.width) continue;
      src = { left: r.left + r.width / 2 - to.width / 2, top: r.top + r.height / 2 - to.height / 2, width: to.width, height: to.height };
    }
    const ghost = target.cloneNode(true);
    ghost.classList.remove("fresh", "last");
    Object.assign(ghost.style, { position: "fixed", left: `${to.left}px`, top: `${to.top}px`, margin: "0", zIndex: 40, pointerEvents: "none" });
    ghost.style.setProperty("--w", `${to.width}px`);  // keep the pile's tile size outside the pile
    document.body.appendChild(ghost);
    target.style.visibility = "hidden";
    const dx = src.left - to.left, dy = src.top - to.top, sc = src.width / to.width;
    ghost.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, transformOrigin: "top left" },
      { transform: "none", transformOrigin: "top left" },
    ], { duration: 480, easing: "cubic-bezier(.2, .8, .2, 1)" }).finished.then(() => {
      ghost.remove();
      target.style.visibility = "";
    });
  }
}

// Settings menu: each row is a switch bound to a saved preference
function renderSettings() {
  $("sortBtn").setAttribute("aria-checked", String(prefs.autoSort));
  $("scoresBtn").setAttribute("aria-checked", String(prefs.showScores));
  $("flowersBtn").setAttribute("aria-checked", String(prefs.noFlowers));
  $("claimedBtn").setAttribute("aria-checked", String(prefs.showClaimed));
  $("soundBtn").setAttribute("aria-checked", String(prefs.sound));
  setSoundEnabled(prefs.sound);
  document.body.classList.toggle("show-claimed", prefs.showClaimed);
  document.querySelectorAll("[data-diff]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.diff === prefs.difficulty)));
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === prefs.lang)));
}
function toggleSettings(open = $("settings").hidden) {
  $("settings").hidden = !open;
  document.body.classList.toggle("settings-open", open);
  // the menu opens upward from the button: it never runs off the top of the screen (it scrolls instead)
  // (phones show it as a bottom sheet instead, sized in the CSS)
  if (open) $("settings").style.maxHeight = matchMedia("(max-width: 600px)").matches || LANDSCAPE.matches ? "" : `${Math.max(200, $("settingsBtn").getBoundingClientRect().top - 8 - 12)}px`;
  $("settingsBtn").setAttribute("aria-expanded", String(open));
}

function renderStatus() {
  if (!$("status")) return; // the current layout has no status row
  const me = G.seatWind(state, 0);
  $("status").innerHTML = [
    `<span class="scope">${WIND_EN[state.prevailing]} round</span>`,
    `<span class="scope">Hand ${state.handNo}</span>`,
    `<span class="scope">${G.liveTiles(state)} tiles left</span>`,
    `<span class="scope">You're ${WIND_EN[me]}${me === 0 ? " (dealer)" : ""}</span>`,
    `<span class="scope">Min ${state.minFan} fan to win</span>`,
  ].join("");
}

// Whose turn it is: the player drawing / discarding, and that same player while their discard waits on
// the others (Continue or a call). Your label only lights up on your own turn. Nobody once the hand is over.
function turnHolder() {
  if (state.phase === "act" || state.phase === "draw") return state.current;
  if (state.phase === "claim") return state.lastDiscard?.from ?? null;
  return null;
}

function plateHtml(p) {
  const pl = state.players[p];
  const sw = G.seatWind(state, p);
  const on = turnHolder() === p;
  // a bot that's drawing or deciding shows thinking dots instead of its wind; the wind comes back once it moves
  const thinking = p !== 0 && state.current === p && (state.phase === "draw" || state.phase === "act");
  const name = p === 0 ? "You" : pl.name;
  const pts = prefs.showScores ? `<span class="pts">${pl.score}</span>` : "";
  const title = `${name}: ${WIND_EN[sw]} seat${sw === 0 ? ", dealer" : ""}`;
  return `<div class="who ${p === 0 ? "mine" : ""}" title="${title}">
    <div class="plate circle ${on ? "on" : ""} ${thinking ? "thinking" : ""}">${thinking
      ? `<span class="dots" role="img" aria-label="${zh(WINDS[sw])}, thinking"><i></i><i></i><i></i></span>`
      : `<span class="wind">${zh(WINDS[sw])}</span>`}</div>
    <span class="pname">${name}${pts}</span>
  </div>`;
}

/* Phones (Figma 2350:25132): all four players together at the top of the bottom sheet, as a compass of wind
   circles placed where each player sits: you at the bottom, the player opposite on top, the others either side. */
function compassHtml() {
  const pos = ["b", "r", "t", "l"];
  const circles = [0, 1, 2, 3].map((p) => {
    const pl = state.players[p], sw = G.seatWind(state, p);
    const on = turnHolder() === p;
    const thinking = p !== 0 && state.current === p && (state.phase === "draw" || state.phase === "act");
    const name = p === 0 ? "You" : pl.name;
    const title = `${name}: ${WIND_EN[sw]} seat${sw === 0 ? ", dealer" : ""}${prefs.showScores ? `, ${pl.score} points` : ""}`;
    return `<span class="plate circle c-${pos[p]} ${on ? "on" : ""} ${thinking ? "thinking" : ""}" title="${title}" role="img" aria-label="${title}">${thinking
      ? `<span class="dots"><i></i><i></i><i></i></span>` : `<span class="wind">${zh(WINDS[sw])}</span>`}</span>`;
  }).join("");
  // the label names whoever's turn it is (you when nobody's: between hands)
  const who = turnHolder() ?? 0;
  const pts = prefs.showScores ? `<span class="pts">${state.players[who].score}</span>` : "";
  return `<div class="compass"><div class="compass-ring">${circles}</div><span class="pname">${who === 0 ? "You" : state.players[who].name}${pts}</span></div>`;
}

function meldsHtml(pl, size) {
  const melds = pl.melds.map((m) => {
    const tiles = m.tiles.map((id, i) => {
      const k = kindOf(id);
      const hidden = m.concealed && (i === 0 || i === 3);
      return tileHtml(k, { size, cls: `${hidden ? "face-down" : ""} ${id === m.claimed ? "claimed" : ""}` });
    });
    return `<span class="meld" title="${m.concealed ? "Concealed kong" : m.type === "pung" ? "peng" : m.type}">${tiles.join("")}</span>`;
  });
  const fl = pl.flowers.length ? `<span class="flowers">${pl.flowers.map((id) => tileHtml(kindOf(id), { size })).join("")}</span>` : "";
  return melds.join("") + fl;
}

function renderSeat(p) {
  const pl = state.players[p];
  const el = document.querySelector(`.seat[data-p="${p}"]`);
  // when this player has won, their tiles turn face up (in their winning groups), the winning tile outlined
  const r = state.phase === "over" && state.result;
  const won = r && r.type !== "draw" && r.winner === p;
  const backs = won
    ? wonGroups(pl, r).flat().map(({ k, id }) => tileHtml(k, { size: "xs", cls: id === r.tile ? "won-tile" : "" })).join("")
    : Array.from({ length: pl.hand.length }, () => backHtml("xs")).join("");
  // one line per player, like a real table: called sets and flowers face-up first, then the face-down hand
  el.innerHTML = `${plateHtml(p)}<div class="line">${meldsHtml(pl, "xs")}<span class="backs" title="${pl.hand.length} tiles in hand">${backs}</span></div>`;
}

// discards already on screen, so only a newly thrown tile plays the drop-in animation
const shownDiscards = new Set();
let shownHand = 0;

// One shared discard area, tiles upright at your hand's size, in the order they were thrown.
// The tile still in play (waiting on Continue or a call) sits in the action bar instead, and joins
// the area once everyone has passed.
function renderPools() {
  if (shownHand !== state.handNo) {
    // new hand, page load or take-back: whatever is already on the table just appears
    shownDiscards.clear();
    shownHand = state.handNo;
    state.players.forEach((pl) => pl.discards.forEach((d) => shownDiscards.add(d.id)));
  }
  const ld = state.lastDiscard;
  // the discard stays in the white box only while you decide whether to call it; otherwise it goes straight to the pile
  const inPlay = state.phase === "claim" && ld && !ld.robbing && G.claimPendingFor(state, 0) ? ld.id : null;
  const all = [];
  state.players.forEach((pl, p) => pl.discards.forEach((d, i) => {
    if (!d.taken && d.id !== inPlay) all.push({ ...d, from: p, order: d.n ?? i * 4 + p });
  }));
  for (const d of all) if (!shownDiscards.has(d.id)) freshDiscards.push({ id: d.id, from: d.from });
  all.sort((a, b) => a.order - b.order);
  const lastShown = all.length ? all[all.length - 1].id : null;
  $("discards").classList.toggle("grouped", prefs.autoSort);
  // The wall always comes first: a face-down tile with the number of tiles left to draw.
  const left = G.liveTiles(state);
  const wall = `<span class="dstack wall" role="img" title="${left} tiles left in the wall" aria-label="${left} tiles left in the wall">${backHtml("lg")}<span class="dcount">${left}</span></span>`;
  if (!prefs.autoSort) {
    // Autosort off: every tile in the order it was thrown
    $("discards").innerHTML = wall + all.map((d) => {
      const fresh = !shownDiscards.has(d.id);
      shownDiscards.add(d.id);
      return tileHtml(kindOf(d.id), { size: "lg", cls: `${d.id === lastShown ? "last" : ""}` }).replace('<span class="tile', `<span data-tile-id="${d.id}" class="tile`);
    }).join("");
    return;
  }
  // Autosort on: one tile per kind, in suit order, with a count when more than one is out,
  // so you can see at a glance how many of each tile are gone (there are 4 of each).
  const groups = new Map();
  for (const d of all) {
    const k = kindOf(d.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d.id);
  }
  $("discards").innerHTML = wall + [...groups.keys()].sort((a, b) => a - b).map((k) => {
    const ids = groups.get(k);
    const unseen = ids.filter((id) => !shownDiscards.has(id));
    ids.forEach((id) => shownDiscards.add(id));
    const isNewKind = unseen.length === ids.length;   // first of its kind: the tile drops in
    const bumped = unseen.length && !isNewKind;        // another of a kind already out: the count pops (as the tile lands)
    const n = ids.length;
    const tile = tileHtml(k, { size: "lg", title: false, cls: `${ids.includes(lastShown) ? "last" : ""}` });
    const label = `${tileName(k)}: ${n} discarded`;
    return `<span class="dstack" data-tile-id="${ids.join(" ")}" title="${label}" role="img" aria-label="${label}">${tile}${n > 1 ? `<span class="dcount ${bumped ? "bump" : ""}">×${n}</span>` : ""}</span>`;
  }).join("");
}



// Autosort on: suit and number order, so a drawn tile slots straight into place (the rise animation
// marks it). Off: your own order, with any new tile (drawn or claimed) added at the right end.
function handOrder(hand) {
  const sorted = hand.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);
  if (prefs.autoSort) return sorted;
  const kept = myOrder.filter((id) => hand.includes(id));
  const ids = [...kept, ...sorted.filter((id) => !kept.includes(id))];
  if (ids.length !== myOrder.length || ids.some((id, i) => id !== myOrder[i])) { myOrder = ids; saveOrder(); }
  return ids;
}

/* Your concealed tiles split into the winning hand's groups (sets, then the pair), each tile with its id so the
   winning one can be marked. Special hands (seven pairs, thirteen orphans) group as pairs / one row. */
function wonGroups(pl, r) {
  const left = pl.hand.slice();
  const take = (k) => {
    // the winning tile goes in the first group that needs its kind, so it's always shown
    let i = left.findIndex((id) => id === r.tile && kindOf(id) === k);
    if (i < 0) i = left.findIndex((id) => kindOf(id) === k);
    return { k, id: left.splice(i, 1)[0] };
  };
  const arr = r.arrangement;
  let groups;
  if (arr && !arr.special) {
    groups = arr.sets.map((st) => (st.type === "pung" ? [st.k, st.k, st.k] : [st.k, st.k + 1, st.k + 2]));
    groups.push([arr.pair, arr.pair]);
  } else if (arr && arr.special === "sevenPairs") {
    const ks = [...new Set(pl.hand.map(kindOf))].sort((a, b) => a - b);
    groups = ks.map((k) => [k, k]);
  } else {
    groups = [pl.hand.map(kindOf).sort((a, b) => a - b)];
  }
  const out = groups.map((g) => g.map(take));
  if (left.length) out.push(left.map((id) => ({ k: kindOf(id), id })));  // anything unexpected still shows
  return out;
}

/* One sentence for a win: "Player 1 drew 5 Circles and got Mahjong." / "You took Player 3's 6 Bamboo and got Mahjong!" */
function winSay(p, selfDraw, from, k) {
  const who = p === 0 ? "You" : `<b>${state.players[p].name}</b>`;
  const whose = selfDraw ? "" : from === 0 ? "your" : `<b>${state.players[from].name}</b>'s`;
  return `${who} ${selfDraw ? "drew" : `took ${whose}`} <b>${tileName(k)}</b> and got Mahjong${p === 0 ? "!" : "."}`;
}

function renderMe() {
  const pl = state.players[0];
  $("mePlate").innerHTML = PHONE.matches || LANDSCAPE.matches ? compassHtml() : plateHtml(0);
  $("meExposed").innerHTML = meldsHtml(pl, "md");
  const live = myTurn();
  const hand = pl.hand.slice();
  const drawn = state.drawn !== null && state.current === 0 && hand.includes(state.drawn) ? state.drawn : null;
  const ids = handOrder(hand);
  if (selected !== null && !ids.includes(selected)) selected = null;
  if (!G.claimPendingFor(state, 0)) callPick = [];
  callPick = callPick.filter((id) => ids.includes(id));
  const picking = G.claimPendingFor(state, 0) && !state.lastDiscard.robbing;
  const isNew = drawn !== null && drawn !== lastDrawn;
  lastDrawn = drawn;
  const el = $("hand");
  // your win: the hand laid out in its winning groups, the winning tile (drawn or taken) with a thin dark outline
  const r = state.phase === "over" && state.result;
  if (r && r.type !== "draw" && r.winner === 0) {
    el.classList.remove("live", "spread", "manual");
    el.classList.add("won");
    el.innerHTML = wonGroups(pl, r).map((g) => `<span class="won-group">${g.map(({ k, id }) =>
      tileHtml(k, { size: "lg", cls: id === r.tile ? "won-tile" : "" })).join("")}</span>`).join("");
    return;
  }
  el.classList.remove("won");
  el.classList.toggle("live", live || picking);
  el.innerHTML = ids.map((id) => tileHtml(kindOf(id), {
    size: "lg", id, button: true,
    cls: `${id === selected ? "sel" : ""} ${callPick.includes(id) ? "picked" : ""} ${id === drawn && isNew ? "new" : ""}`,
  })).join("");
  el.classList.toggle("manual", !prefs.autoSort);
  // a full hand (13 or 14 tiles) lines up with the white box's left and right edges
  el.classList.toggle("spread", ids.length >= 13);
  el.style.setProperty("--n", ids.length);  // lets CSS cap the stretched gaps
  // not `disabled`: with Autosort off you can rearrange tiles while others play
  el.querySelectorAll(".tile").forEach((b) => { b.setAttribute("aria-disabled", String(!live && !picking)); b.setAttribute("aria-pressed", String(b.dataset.id == selected)); });
}

const seenInPlay = new Set();
const arrive = (key) => { key = `${state.handNo}:${key}`; return seenInPlay.has(key) ? "" : (seenInPlay.add(key), "arrive"); };

function renderBar() {
  const bar = $("bar");
  let say = "", play = "";
  const btns = [];
  if (announce) {
    const a = announce;
    const who = state.players[a.q].name;
    const fromWho = a.from === 0 ? "your discard" : `${state.players[a.from].name}'s discard`;
    const what = a.type === "pung" ? "peng" : a.type;
    say = `<b>${who}</b> called a <b>${what}</b> of <b>${tileName(a.k)}</b> from ${fromWho}.`;
    play = a.tiles.map((k) => tileHtml(k, { size: "lg" })).join("");
    btns.push(`<button type="button" class="btn" data-ann-ok>Continue</button>`);
  } else if (myTurn()) {
    // name the tile you just drew (it's still in your hand), so you don't have to hunt for it
    const justDrew = state.drawn !== null && state.drawn !== undefined && state.players[0].hand.includes(state.drawn);
    say = state.afterClaim ? "Now discard a tile."
      : selected !== null ? "Press Discard, or tap the tile again to put it back."
      : justDrew ? `You just drew <b>${tileName(kindOf(state.drawn))}</b>. Tap a tile to pick your discard.`
      : "Your turn. Tap a tile to pick your discard.";
    if (selected !== null) {
      // the tile you picked shows in the tile-in-play spot. Only Discard throws it; tapping the tile puts it back
      const k = kindOf(selected);
      play = `<button type="button" class="inplay-pick" data-act="putback" aria-label="Put ${tileName(k)} back in your hand">${tileHtml(k, { size: "lg", title: false, cls: arrive(`s${selected}`) }).replace('<span class="tile', `<span data-fly-id="${selected}" class="tile`)}</button>`;
      btns.push(`<button type="button" class="btn" data-act="discard">Discard</button>`);
    }
    const o = G.actOptions(state, 0);
    if (o.tsumo && o.tsumo.legal) {
      // a winning hand: Mahjong is the only button (no discarding)
      // like a win off a discard: the tile that won it shows in the tile-in-play spot (the one you just drew)
      say = "You got Mahjong!";
      play = "";
      if (state.drawn !== null && state.drawn !== undefined) {
        const k = kindOf(state.drawn);
        say = winSay(0, true, null, k);
        play = tileHtml(k, { size: "lg", cls: arrive(`w${state.drawn}`) });
      }
      btns.length = 0;  // no button: the win happens by itself a moment later
    }
  } else if (G.claimPendingFor(state, 0)) {
    const ld = state.lastDiscard;
    const k = kindOf(ld.id);
    const who = state.players[ld.from].name;
    const o = state.claim.options[0];
    say = `<b>${who}</b> ${ld.robbing ? `is adding <b>${tileName(k)}</b> to a kong` : `discarded <b>${tileName(k)}</b>`}.${ld.robbing ? "" : `<span class="say-more"> Continue or add tiles to call it.</span>`}`;
    if (o.win) say = winSay(0, false, ld.from, k);
    // the set you're forming: the discard plus every tile you've lifted, in order (tap one of yours to drop it)
    const set = [{ k, id: null }, ...callPick.map((id) => ({ k: kindOf(id), id }))].sort((a, b) => a.k - b.k || (a.id === null ? -1 : 1));
    play = set.map((t) => t.id === null
      ? tileHtml(t.k, { size: "lg", cls: arrive(`d${ld.id}`) }).replace('<span class="tile', `<span data-fly-id="${ld.id}" class="tile`)
      : `<button type="button" class="inplay-pick" data-unpick="${t.id}" aria-label="Put back ${tileName(t.k)}">${tileHtml(t.k, { size: "lg", title: false, cls: `mine ${arrive(`m${ld.id}-${t.id}`)}` })}</button>`).join("");
    // one button: Continue, which becomes Call once you've lifted tiles from your hand
    // after any call that doesn't work, Call becomes Undo: it puts the lifted tiles back in your hand
    // (when the discard wins it for you, Mahjong is the only button)
    const undo = nudge && nudge.key === nudgeKey();
    if (!o.win) btns.push(undo && callPick.length
      ? `<button type="button" class="btn" data-undo-call>${UNDO_ICON}Undo</button>`
      : callPick.length
      ? `<button type="button" class="btn" data-call>${callLabel()}</button>`
      : `<button type="button" class="btn" data-claim="pass">Continue</button>`);
  } else if (state.phase === "over" && (resultClosed || resultHeld || !cardShown())) {
    // the results card was closed: say how the hand ended and offer the card again (a secondary grey button;
    // the main next step is the New game button, which turns black while the hand is over)
    const r = state.result;
    const who = r.winner === 0 ? "You" : `<b>${state.players[r.winner]?.name}</b>`;
    const got = r.winner === 0 ? "You got Mahjong!" : `${who} got Mahjong.`;  // no exclamation mark when someone else wins
    if (r.type === "draw") say = "It's a draw.";
    else if (r.tile === null || r.tile === undefined) say = got;
    else {
      // the same words and tile as when the win came up: the tile drawn, or the discard it was won off
      const k = kindOf(r.tile);
      say = winSay(r.winner, r.selfDraw, r.from, k);
      play = tileHtml(k, { size: "lg" });
    }
    const mine = r.type !== "draw" && r.winner === 0;
    if (mine) {
      // your win: playing for points, the points are one tap away (that card has Start new game); otherwise start over
      btns.push(prefs.showScores
        ? `<button type="button" class="btn" data-open-result>View points</button>`
        : `<button type="button" class="btn" data-new-game>Start new game</button>`);
    } else if (prefs.showScores) {
      if (!resultHeld) btns.push(`<button type="button" class="btn light" data-open-result>${r.type === "draw" ? "See result" : "View winning hand"}</button>`);
    } else if (!resultHeld) {
      // playing without points there's no results card: your winning hand is laid out below, and another
      // player's is face up at their seat
      btns.push(`<button type="button" class="btn" data-new-game>Start new game</button>`);
    }
  } else if (state.phase === "claim" && state.lastDiscard?.robbing) {
    // someone adding to a kong can still be robbed: show it while the others decide
    const ld = state.lastDiscard;
    const k = kindOf(ld.id);
    const who = ld.from === 0 ? "You" : state.players[ld.from].name;
    say = `<b>${who}</b> ${ld.from === 0 ? "are" : "is"} adding <b>${tileName(k)}</b> to a kong.`;
    play = tileHtml(k, { size: "lg", cls: arrive(`d${ld.id}`) });
  }
  // a finished discard needs no words: it flies into the discard pile (see flyDiscards)
  const why = nudge && nudge.key === nudgeKey();
  // just words, no tile or button: the compact box centres them instead of setting them to the left
  bar.classList.toggle("solo", !play && !btns.length);
  // when the hand is over, starting a new game is the main thing to do: the New game button turns black
  // (playing without points the white box has its own Start new game, so this one stays quiet)
  const overMain = state.phase === "over" && prefs.showScores && !(state.result && state.result.type !== "draw" && state.result.winner === 0);
  $("newBtn").classList.toggle("primary", overMain);
  document.body.classList.toggle("hand-over", state.phase === "over");
  $("newBtn").classList.toggle("light", !overMain);
  // Undo: anything of yours to take back this hand (not after you've won)
  const won = state.phase === "over" && state.result && state.result.type !== "draw" && state.result.winner === 0;
  $("undoBtn").hidden = !history.length || dealing || won;  // only there once there's a move to take back
  bar.innerHTML = `<div class="act-left">
      <div class="say ${why ? "nudge" : ""}" ${why ? 'role="status"' : ""}>${why ? nudge.html : say}</div>
      <div class="inplay">${play}</div>
    </div>
    <div class="act-right">${btns.join("")}</div>`;
}

/* ---------------- coach chathead + pane ---------------- */

function unread() { return notes.filter((n) => !n.read).length; }

function renderCoach() {
  const c = $("coach");
  const av = $("coachAv");
  if (av) av.outerHTML = coachTileHtml();  // first render: draw the floating Guanyin tile
  // a new note flips Guanyin to the red seal (instead of a number badge)
  const u = unread();
  c.classList.toggle("has-note", u > 0);
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
  notes.forEach((x) => { x.read = true; });  // only the latest tip matters: older ones won't come back
  pane = { ...pane, open: true, view: "note", id };
  hideBubble();
  render();
  $("paneBody").scrollTop = 0;  // always open at the top
}
function openList() {
  pane = { ...pane, open: true, view: "list", id: null };
  hideBubble();
  render();
  $("paneBody").scrollTop = 0;  // always open at the top
}
function closePane() { pane.open = false; render(); }

/* A call's set in the green box: one row, your own tiles a little see-through, the name of the tile taken under it. */
function setTilesHtml(set, k) {
  return `<div class="pick-set"><span class="pick-set-row">${set.map((x) => tileHtml(x.k, { size: "md", cls: x.mine ? "mine" : "" })).join("")}</span><span class="sub">${tileName(k)}</span></div>`;
}

function renderPane() {
  const el = $("pane");
  el.classList.toggle("open", pane.open);
  el.setAttribute("aria-hidden", String(!pane.open));
  if (!pane.open) return;
  // the panel's header shows Guanyin in place of the word "Coach"
  const pav = $("paneAv");
  if (pav && !pav.firstChild) pav.outerHTML = coachPortraitHtml().replace('class="coach-portrait"', 'id="paneAv" class="coach-portrait head"');
  const body = $("paneBody");
  if (pane.view === "note") {
    const n = notes.find((x) => x.id === pane.id);
    if (!n) { pane.view = "list"; return renderPane(); }
    const cmp = n.compare ? `<div class="compare">
      <div class="compare-card mine"><span class="lbl">${n.compare.mine.label}</span>${tileHtml(n.compare.mine.k, { size: "md" })}<span class="sub">${n.compare.mine.sub || tileName(n.compare.mine.k)}</span></div>
      <div class="compare-card best"><span class="lbl">${n.compare.best.label}</span>${tileHtml(n.compare.best.k, { size: "md" })}<span class="sub">${n.compare.best.sub || tileName(n.compare.best.k)}</span></div>
    </div>` : "";
    const setCard = n.set ? `<div class="compare single"><div class="compare-card best"><span class="lbl">${n.set.label}</span>${setTilesHtml(n.set.tiles, n.set.k)}</div></div>` : "";
    const canUndo = n.snapshot && n.handNo === state.handNo;
    body.innerHTML = `<h3>${n.title}</h3>${cmp}${setCard}${n.html}
      <div class="pane-actions">
        ${canUndo ? `<button type="button" class="btn" data-undo="${n.id}">${UNDO_ICON}Take it back</button>` : ""}
        <button type="button" class="btn light" data-close>Got it</button>
      </div>`;
    return;
  }
  // One level only: the panel shows either the tip the coach just raised (the note view above) or, when you
  // ask, "Here's what I'd do". Notes aren't kept in a list.
  const yourMove = myTurn() || G.claimPendingFor(state, 0);
  const h = pane.hint || (yourMove ? Coach.hint(state) : null);
  // one tile, or every equally good tile side by side, each with its name under it
  const ks = h?.pick ? (h.pick.ks || (h.pick.k !== undefined ? [h.pick.k] : [])) : [];
  // a call: the whole set in one row (your tiles a little see-through), named after the tile you'd take
  const pickTiles = h?.pick?.set
    ? setTilesHtml(h.pick.set, h.pick.k)
    : ks.length ? `<div class="pick-tiles">${ks.map((k) => `<span class="pick-tile">${tileHtml(k, { size: "md" })}<span class="sub">${tileName(k)}</span></span>`).join("")}</div>` : "";
  const pickCard = h?.pick ? `<div class="compare single"><div class="compare-card best"><span class="lbl">${h.pick.label}</span>${pickTiles}</div></div>` : "";
  const action = h?.win ? `<button type="button" class="btn red" data-pane-mahjong>Mahjong</button>` : `<button type="button" class="btn" data-close>Got it</button>`;
  const suggestion = h ? `<h3>${h.title}</h3>${pickCard}${h.html}<div class="pane-actions">${action}</div>` : "";
  // not your move: one quiet line so the panel isn't empty
  body.innerHTML = h ? suggestion : `<p class="empty">It's not your turn yet. I'll speak up if I spot something.</p>`;
}

/* ---------------- modals ---------------- */

let guideOpen = false;
let resultClosed = false;
let resultAsked = false;  // the card was asked for (View points, See their hand)
// The results card comes up by itself only for another player's win (or a draw) when playing for points.
// Your own win never pops it up: the white box shows it, with View points when playing for points.
const cardShown = () => resultAsked || (prefs.showScores && !(state.result && state.result.type !== "draw" && state.result.winner === 0));  // the results card was closed to look at the table (the bar can bring it back)
// When someone else wins (or the wall runs out), the table holds for a moment first, showing who won and the
// tile that did it, before the results card comes up. (Your own win already pauses: you tap Mahjong.)
const RESULT_HOLD = 1500;
let resultHeld = false;
let heldResult = state.phase === "over" ? state.result : null;  // a hand already over on load shows its card at once
let confirmNew = false;     // New game was tapped once: the button now says Confirm (a second tap starts over)
let confirmTimer = null;

function renderModal() {
  const m = $("modal");
  const card = $("modalCard");
  if (dealing) { m.hidden = true; return; }  // the results card steps away while the next hand is dealt
  if (guideOpen) {
    m.hidden = false;
    card.innerHTML = guideHtml();
    return;
  }
  if (state.phase !== "over" || resultClosed || resultHeld || !cardShown()) { m.hidden = true; return; }
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

const CLOSE_ICON = `<svg width="14" height="14" viewBox="0 0 18 18" fill="none"><path d="M1.5 1.5L16.5 16.5M16.5 1.5L1.5 16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

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
    // playing without points: just how the hand was won and its groups, no fan or payments
    lede = !prefs.showScores ? how : `${how} · ${r.fan} fan · ${r.selfDraw ? `${r.points} from each player` : `${r.points * 2} from ${r.from === 0 ? "you" : state.players[r.from].name}`}`;
    body = handGroups(r.winner, r.arrangement) + (!prefs.showScores ? "" :
      `<ul class="fan-list">${r.items.map(([n, f]) => `<li><span>${n}</span><span>${f}</span></li>`).join("")}<li class="total"><span>Total${r.fan === 13 ? " (limit)" : ""}</span><span>${r.fan} fan</span></li></ul>`);
  }
  const delta = r.delta || [0, 0, 0, 0];
  const scores = state.players.map((pl, i) => `<div class="score-cell"><b>${pl.name}</b>${prefs.showScores ? `<span>${pl.score}</span>` : ""}
    <em class="${delta[i] > 0 ? "up" : delta[i] < 0 ? "down" : ""}">${delta[i] > 0 ? "+" : ""}${delta[i] || "–"}</em></div>`).join("");
  // for now a finished hand always leads to a fresh game (a "next hand" that carries scores on may come later)
  return `<button type="button" class="icon-btn modal-close" data-close-result aria-label="Close">${CLOSE_ICON}</button>
    <h2>${head}</h2><p class="lede">${lede}</p>${body}${prefs.showScores ? `<div class="scores">${scores}</div>` : ""}
    <div class="btns">
      <button type="button" class="btn" data-new-game>Start new game</button>
    </div>`;
}

function guideHtml() {
  const rows = FAN_GUIDE.map(([n, f, d]) => `<li><b>${n}</b><span>${f === 13 ? "Limit" : f + " fan"}</span><small>${d}</small></li>`).join("");
  return `<h2>How to play</h2>
    <div class="basics">
      <p>Make a hand of <b>four sets and a pair</b> (14 tiles). A set is a <b>chow</b> (three in a row in one suit), a <b>peng</b> (three of a kind) or a <b>kong</b> (four of a kind, which earns you a replacement tile).</p>
      <p>Each turn you draw, then discard. Anyone can claim a discard for a peng, kong or win; only the next player can claim it for a chow. A win beats a peng, and a peng beats a chow.</p>
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
  if (dragJustEnded) return;
  if (b && G.claimPendingFor(state, 0) && !state.lastDiscard.robbing) {
    if (state.claim.options[0].win) return;  // the discard wins it for you: the only move is Mahjong
    const id = +b.dataset.id;
    callPick = callPick.includes(id) ? callPick.filter((x) => x !== id) : callPick.length < 3 ? [...callPick, id] : callPick;
    nudge = null;
    return render();
  }
  if (!b || !myTurn()) return;
  const wins = G.actOptions(state, 0).tsumo;
  if (wins && wins.legal) return;  // a winning hand: the only move is Mahjong
  const id = +b.dataset.id;
  selected = selected === id ? null : id;
  render();
});

$("bar").addEventListener("click", (e) => {
  if (announce && e.target.closest("[data-ann-ok]")) { announce = null; return update(); }
  if (e.target.closest("[data-open-result]")) return openResult();
  if (e.target.closest("#bar [data-new-game]")) return newGame();
  const a = e.target.closest("[data-act]");
  if (a && myTurn()) {
    if (a.dataset.act === "discard" && selected !== null) act({ type: "discard", id: selected });
    if (a.dataset.act === "putback") { selected = null; render(); }
    if (a.dataset.act === "mahjong") mahjongOnTurn();
    return;
  }
  if (!G.claimPendingFor(state, 0)) return;
  const un = e.target.closest("[data-unpick]");
  if (un) { callPick = callPick.filter((id) => id !== +un.dataset.unpick); nudge = null; return render(); }
  if (e.target.closest("[data-call]")) return callPicked();
  if (e.target.closest("[data-undo-call]")) { callPick = []; nudge = null; return render(); }
  if (e.target.closest("[data-mahjong]")) return mahjongOnDiscard();
  if (e.target.closest("[data-claim=pass]")) return claim({ type: "pass" });
});

$("coach").addEventListener("click", () => {
  if (pane.open) return closePane();
  const fresh = notes.filter((n) => !n.read);
  if (fresh.length) return openNote(fresh[fresh.length - 1].id);  // the coach has something new to say: that first
  // otherwise, on your move, "Coach me" means you want help: answer straight away, as "What would you do?" does
  if (myTurn() || G.claimPendingFor(state, 0)) pane.hint = Coach.hint(state);
  openList();
});
$("bubble").addEventListener("click", () => openNote(+$("bubble").dataset.id));
$("paneClose").addEventListener("click", closePane);
// phones: swipe either sheet down to close it
swipeToClose($("pane"), $("paneBody"), closePane);
swipeToClose($("settings"), $("settings"), () => toggleSettings(false), { slideOut: true });
$("paneBody").addEventListener("click", (e) => {
  const u = e.target.closest("[data-undo]");
  if (u) return takeBack(+u.dataset.undo);
  if (e.target.closest("[data-close]")) return closePane();
  // the coach's "You can win" card: its Mahjong button wins, with the confetti bursting from it
  const mj = e.target.closest("[data-pane-mahjong]");
  if (mj) { mahjongOnTurn(mj); return closePane(); }
  if (e.target.closest("[data-hint]")) { pane.hint = Coach.hint(state); render(); }
});

$("modal").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-guide]") || (guideOpen && e.target === $("modal"))) { guideOpen = false; render(); return; }
  if (e.target.closest("[data-open-coach]")) { openList(); return; }
  if (e.target.closest("[data-next]")) startNextHand();
  if (e.target.closest("[data-new-game]")) newGame();
  // close the results card: its X, or a tap on the blurred table around it
  if (state.phase === "over" && !guideOpen && (e.target.closest("[data-close-result]") || e.target === $("modal"))) closeResult();
});

function closeResult() { resultClosed = true; resultAsked = false; render(); }
function openResult() { resultClosed = false; resultAsked = true; render(); }

$("settingsBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleSettings(); });
$("undoBtn").addEventListener("click", (e) => { e.stopPropagation(); undo(); });
$("settingsClose").addEventListener("click", (e) => { e.stopPropagation(); toggleSettings(false); $("settingsBtn").focus(); });
document.addEventListener("click", (e) => { if (!$("settings").hidden && !e.target.closest(".settings-wrap")) toggleSettings(false); });
$("sortBtn").addEventListener("click", () => {
  // turning it off starts your own order from the sorted one you were looking at
  if (prefs.autoSort) {
    myOrder = state.players[0].hand.slice().sort((a, b) => kindOf(a) - kindOf(b) || a - b);
    saveOrder();
  }
  prefs.autoSort = !prefs.autoSort;
  savePrefs();
  render();
});

/* Drag to rearrange your hand (Autosort off). Pointer events, so mouse and touch both work.
   A press that doesn't move is still a normal tap (select / discard). */
let drag = null;
let dragJustEnded = false;
$("hand").addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".tile");
  if (!el || prefs.autoSort || e.button > 0) return;
  const tiles = [...$("hand").querySelectorAll(".tile")];
  drag = { el, id: +el.dataset.id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, tiles,
    from: tiles.indexOf(el), to: tiles.indexOf(el), mids: tiles.map((t) => { const r = t.getBoundingClientRect(); return r.left + r.width / 2; }),
    step: tiles.length > 1 ? tiles[1].getBoundingClientRect().left - tiles[0].getBoundingClientRect().left : 0 };
});
$("hand").addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.on) {
    if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
    drag.on = true;
    try { drag.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    drag.el.classList.add("dragging");
    $("hand").classList.add("is-dragging");
  }
  e.preventDefault();
  drag.el.style.transform = `translate(${dx}px, -12px)`;
  const x = e.clientX;
  let to = 0;
  drag.mids.forEach((m, j) => { if (j !== drag.from && m < x) to++; });
  drag.to = to;
  drag.tiles.forEach((t, j) => {
    if (j === drag.from) return;
    const shift = drag.from < j && j <= to ? -drag.step : to <= j && j < drag.from ? drag.step : 0;
    t.style.transform = shift ? `translateX(${shift}px)` : "";
  });
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  const ids = d.tiles.map((t) => +t.dataset.id);
  ids.splice(d.to, 0, ids.splice(d.from, 1)[0]);
  myOrder = ids;
  saveOrder();
  dragJustEnded = true;
  setTimeout(() => { dragJustEnded = false; }, 0);
  $("hand").classList.remove("is-dragging");
  render();
}
$("hand").addEventListener("pointerup", endDrag);
$("hand").addEventListener("pointercancel", endDrag);

document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
  prefs.lang = b.dataset.lang;
  setLang(prefs.lang);
  savePrefs();
  render();
  localize(document.body);  // text already on screen that render() didn't redraw
}));
/* Whatever text appears, from any part of the game, uses the chosen language's spelling of the calls. */
new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === "characterData") localize(m.target.parentNode);
    else m.addedNodes.forEach((n) => localize(n.nodeType === 3 ? n.parentNode : n));
  }
}).observe(document.body, { childList: true, subtree: true, characterData: true });
localize(document.body);
document.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => {
  prefs.difficulty = b.dataset.diff;
  savePrefs();
  render();
}));
$("soundBtn").addEventListener("click", () => {
  prefs.sound = !prefs.sound;
  savePrefs();
  render();
});
$("claimedBtn").addEventListener("click", () => {
  prefs.showClaimed = !prefs.showClaimed;
  savePrefs();
  render();
});
$("flowersBtn").addEventListener("click", () => {
  prefs.noFlowers = !prefs.noFlowers;  // takes effect from the next hand dealt
  savePrefs();
  render();
});
$("scoresBtn").addEventListener("click", () => {
  prefs.showScores = !prefs.showScores;
  state.points = prefs.showScores;  // the rule follows straight away: the Win button and the coach update now
  savePrefs();
  save();
  render();
});
$("guideBtn").addEventListener("click", () => { toggleSettings(false); guideOpen = true; render(); });
/* New game asks once, in place: the first tap turns it into "Confirm new game", the second starts over.
   Tapping anywhere else, pressing Escape or waiting 4 seconds puts it back. */
function setConfirmNew(on) {
  confirmNew = on;
  clearTimeout(confirmTimer);
  const b = $("newBtn");
  b.textContent = on ? "Confirm new game" : "New game";
  b.classList.toggle("confirm", on);
  b.setAttribute("aria-label", on ? "Confirm: start a new game (scores reset)" : "New game");
  if (on) confirmTimer = setTimeout(() => setConfirmNew(false), 4000);
}
$("newBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  // once the hand is over there's nothing to lose, so it starts straight away; mid-hand it asks first
  if (confirmNew || state.phase === "over") newGame(); else if (!dealing) setConfirmNew(true);
});
document.addEventListener("click", (e) => { if (confirmNew && !e.target.closest("#newBtn")) setConfirmNew(false); });
/* Phones: tuck the bottom sheet away while the pile gathers (so the animation sits in the middle of the
   screen), and open it again just as the tiles are dealt into your hand. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function dealHooks() {
  if (!PHONE.matches) return {};
  // Phones: the sheet drops fully out of view, the tiles shuffle and deal (yours land where your hand will be),
  // then the sheet rises up behind them; the buttons and labels fade back last.
  const sheet = $("sheet");
  return {
    beforePile: async () => { sheet.classList.add("away"); setSheet(false); await sleep(380); },
    sheetShift: () => sheet.getBoundingClientRect().top - (innerHeight - sheet.offsetHeight),
    afterLand: async () => { sheet.classList.remove("away"); await sleep(420); },
  };
}

/* Start new hand (from the results card): the card goes away, then the same shuffle-and-deal plays into the next hand. */
/* The coach panel slides away first (its .45s transition) so the deal plays on a clear table. */
async function dismissPane() {
  if (!pane.open) return;
  closePane();
  await sleep(450);
}

async function startNextHand() {
  if (dealing) return;
  dealing = true;
  await dismissPane();
  epoch++;
  announce = null;
  selected = null;
  resultClosed = false;
  resultAsked = false;
  $("modal").hidden = true;
  let roundDone = false;
  await dealAnimation(() => {
    roundDone = (state.noFlowers = prefs.noFlowers, G.nextHand(state));
    history = [];
    render();
    save();
  }, dealHooks());
  dealing = false;
  if (roundDone) showBubble({ id: 0, bubble: `On to the ${WIND_EN[state.prevailing]} round.` });
  update();
}

/* A new game plays the shuffle-and-deal transition first (see deal-anim.js); the bots wait until it's done. */
async function newGame() {
  if (dealing) return;
  dealing = true;
  setConfirmNew(false);
  await dismissPane();
  epoch++;  // cancel any bot move still pending from the old game
  announce = null;
  guideOpen = false;
  resultClosed = false;
  resultAsked = false;
  nudge = null;
  selected = null;
  closePane();
  render();
  await dealAnimation(() => {
    state = G.createGame({ noFlowers: prefs.noFlowers, points: prefs.showScores });
    notes = [];
    history = [];
    render();
    save();
  }, dealHooks());
  dealing = false;
  update();
}

document.addEventListener("keydown", (e) => {
  if (e.key === " " && !e.repeat && announce && !guideOpen && !confirmNew && !e.target.closest?.("input, textarea, .settings")) {
    e.preventDefault(); announce = null; update(); return;
  }
  if (e.key === " " && !e.repeat && G.claimPendingFor(state, 0) && !guideOpen && !confirmNew && !e.target.closest?.("input, textarea, .settings")) {
    e.preventDefault();
    if (state.claim.options[0].win) mahjongOnDiscard();  // Space wins rather than passing on a winning tile
    else if (callPick.length) callPicked(); else claim({ type: "pass" });
    return;
  }
  if (e.key === "Escape") {
    if (!$("settings").hidden) { toggleSettings(false); $("settingsBtn").focus(); }
    else if (confirmNew) setConfirmNew(false);
    else if (guideOpen) { guideOpen = false; render(); }
    else if (state.phase === "over" && !resultClosed && !dealing) closeResult();
    else if (pane.open) closePane();
  }
});

// The coach has no close button: a click or tap anywhere outside it (other than the coach tile or its bubble) closes it
document.addEventListener("pointerdown", (e) => {
  if (!pane.open) return;
  if (e.target.closest("#pane, #coach, #bubble")) return;
  closePane();
});

if (TEST) window.__mc = { tick, get state() { return state; }, get notes() { return notes; } };

if (firstVisit && !AUTO) {
  // First visit: the tiles wait face down in the middle until you press "Start new game", then get dealt.
  // Phones: the bottom sheet starts fully off screen and only slides up as the tiles are dealt.
  dealing = true;
  const sh = $("sheet");
  sh.style.transition = "none";  // start off screen without sliding there
  sh.classList.add("away");
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => { sh.style.transition = ""; }));
  introDeal(() => render(), dealHooks()).then(() => { dealing = false; update(); });
} else {
  update();
}
