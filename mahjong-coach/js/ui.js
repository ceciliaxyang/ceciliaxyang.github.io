// Rendering and input. Drives the bots on timers, asks the coach to review each of your
// decisions, and keeps a snapshot before each one so a coach note can "take it back".
import * as G from "./game.js";
import * as St from "./strategy.js";
import * as Coach from "./coach.js";
import { kindOf, FAN_GUIDE, isSuited } from "./engine.js";
import { tileHtml, backHtml, tileName, WINDS, WIND_EN } from "./tiles.js";

// ?autoplay and ?sandbox are for testing: they save to their own slot so your real game is untouched.
const QS = new URLSearchParams(location.search);
const TEST = QS.has("autoplay") || QS.has("sandbox");
const KEY = TEST ? "mahjong-coach:test" : "mahjong-coach:v1";
const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

let state = load() || G.createGame();
G.refreshNames(state);
let notes = [];            // coach notes this session; `snapshot` = state before your move
let selected = null;       // tile id raised in your hand
let epoch = 0;             // bumps to cancel pending bot timers (take-back, new game)
let pane = { open: false, view: "list", id: null, hint: null };
let bubbleTimer = 0;
let lastDrawn = null;
let nudge = null;          // { id, html }: why a call you tried isn't possible (cleared on the next discard)
let callPick = [];         // tiles you've tapped from your hand to call the discard with
const PREFS = TEST ? "mahjong-coach:test-prefs" : "mahjong-coach:prefs";
const prefs = { showScores: false, autoSort: true, showClaimed: false, difficulty: "normal", ...loadPrefs() };
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

function delay() {
  const ph = state.phase;
  if (ph === "draw") return state.current === 0 ? 280 : 260;
  if (AUTO && ph !== "over") return 120;
  if (ph === "act") return state.current === 0 ? null : 720;
  if (ph === "claim") return G.claimPendingFor(state, 0) ? null : 1000;
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
  if (AUTO && ph === "over") { G.nextHand(state); return update(); }
  if (ph === "draw") G.drawTurn(state);
  else if (ph === "act" && state.current !== 0) {
    const p = state.current;
    const a = St.botAct(state, p, G.actOptions(state, p), prefs.difficulty);
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
  nudge = null;
  pane.hint = null;
  addNote(n, before);
  update();
}

function claim(resp) {
  if (!G.claimPendingFor(state, 0)) return;
  const before = clone(state);
  const n = Coach.reviewClaim(before, resp);
  nudge = null;
  callPick = [];
  G.respond(state, 0, resp);
  botsRespond();
  G.resolveClaims(state);
  pane.hint = null;
  addNote(n, before);
  update();
}

/* Calling is up to you: nothing tells you a pung, chow or kong is possible. Tap tiles in your hand to lift
   them and Continue turns into Call. If it isn't a real call, a short line says why. Mahjong only appears
   when you can actually win. */
const nudgeKey = () => `${state.handNo}:${state.phase}:${state.current}:${state.lastDiscard?.id ?? ""}:${state.wall.length}`;
function say(html) { nudge = { key: nudgeKey(), html }; render(); }
const tx = (k) => tileHtml(k, { size: "xs" });

function callPicked() {
  const ld = state.lastDiscard;
  const o = state.claim.options[0];
  const k = kindOf(ld.id);
  const ks = callPick.map(kindOf).sort((a, b) => a - b);
  if (ks.length < 2) return say(`A call needs two tiles from your hand to go with ${tx(k)} (three for a kong). Tap one more.`);
  const same = ks.every((x) => x === k);
  if (same && ks.length === 2) return o.pung ? claim({ type: "pung" }) : say(`You can't pung this tile.`);
  if (same && ks.length === 3) return o.kong ? claim({ type: "kong" }) : say(`There are no tiles left to replace a kong with, so you can't kong now. Pick two for a pung instead.`);
  const run = [...ks, k].sort((a, b) => a - b);
  const isRun = ks.length === 2 && run.every((x) => x < 27 && Math.floor(x / 9) === Math.floor(k / 9)) && run[1] === run[0] + 1 && run[2] === run[1] + 1;
  if (!isRun) {
    if (ks.length === 2 && !isSuited(k)) return say(`Winds and dragons can't make a run. Pick two ${tx(k)} for a pung.`);
    return say(`Those don't make a set with ${tx(k)}. A pung is two more ${tx(k)}${isSuited(k) ? `; a chow is two tiles that run with it, like ${runExample(k)}` : ""}.`);
  }
  if (ld.from !== 3) return say(`That's a chow, and you can only chow the player right before you (${state.players[3].name}). From ${state.players[ld.from].name} you can only pung, kong or win.`);
  return claim({ type: "chow", chow: ks });
}
function mahjongOnDiscard() {
  if (state.claim.options[0].win) claim({ type: "win" });
}
function mahjongOnTurn() {
  const o = G.actOptions(state, 0);
  if (o.tsumo && o.tsumo.legal) act({ type: "tsumo" });
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

// Default: the latest move stacked and centered. If that would push your "You" label below the bottom of the
// window, use the compact one-row version instead (72px shorter). Checked after every render and on resize.
const PHONE = window.matchMedia("(max-width: 600px)");
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
    // keep the page scrollable past the sheet so nothing above it is hidden for good
    document.documentElement.style.setProperty("--sheet-h", sheet.classList.contains("collapsed") ? "calc(28px + env(safe-area-inset-bottom))" : `${sheet.offsetHeight}px`);
  } else if (bar.parentElement === sheet) {
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
}

function fitLayout() {
  const bar = $("bar"), you = $("mePlate");
  if (!bar || !you) return;
  if (PHONE.matches) { bar.classList.remove("compact"); return; }  // phones: always stacked, in the sheet
  bar.classList.remove("compact");  // measure with the default (stacked) layout
  const fits = you.getBoundingClientRect().bottom + window.scrollY + 24 <= window.innerHeight;
  bar.classList.toggle("compact", !fits);
}
window.addEventListener("resize", () => fitLayout());

function render() {
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
}

// Settings menu: each row is a switch bound to a saved preference
function renderSettings() {
  $("sortBtn").setAttribute("aria-checked", String(prefs.autoSort));
  $("scoresBtn").setAttribute("aria-checked", String(prefs.showScores));
  $("claimedBtn").setAttribute("aria-checked", String(prefs.showClaimed));
  document.body.classList.toggle("show-claimed", prefs.showClaimed);
  document.querySelectorAll("[data-diff]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.diff === prefs.difficulty)));
}
function toggleSettings(open = $("settings").hidden) {
  $("settings").hidden = !open;
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
  const thinking = on && p !== 0;
  const name = p === 0 ? "You" : pl.name;
  const pts = prefs.showScores ? `<span class="pts">${pl.score}</span>` : "";
  const title = `${name}: ${WIND_EN[sw]} seat${sw === 0 ? ", dealer" : ""}`;
  return `<div class="who ${p === 0 ? "mine" : ""}" title="${title}">
    <div class="plate circle ${on ? "on" : ""} ${thinking ? "thinking" : ""}"><span class="wind">${WINDS[sw]}</span></div>
    <span class="pname">${name}${pts}</span>
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
  const inPlay = state.phase === "claim" && ld && !ld.robbing ? ld.id : null;
  const all = [];
  state.players.forEach((pl, p) => pl.discards.forEach((d, i) => {
    if (!d.taken && d.id !== inPlay) all.push({ ...d, order: d.n ?? i * 4 + p });
  }));
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
      return tileHtml(kindOf(d.id), { size: "lg", cls: `${d.id === lastShown ? "last" : ""} ${fresh ? "fresh" : ""}` });
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
    const bumped = unseen.length && !isNewKind;        // another of a kind already out: the count pops
    const n = ids.length;
    const tile = tileHtml(k, { size: "lg", title: false, cls: `${ids.includes(lastShown) ? "last" : ""} ${isNewKind ? "fresh" : ""}` });
    const label = `${tileName(k)}: ${n} discarded`;
    return `<span class="dstack" title="${label}" role="img" aria-label="${label}">${tile}${n > 1 ? `<span class="dcount ${bumped ? "bump" : ""}">×${n}</span>` : ""}</span>`;
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

function renderMe() {
  const pl = state.players[0];
  $("mePlate").innerHTML = plateHtml(0);
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
  el.classList.toggle("live", live || picking);
  el.innerHTML = ids.map((id) => tileHtml(kindOf(id), {
    size: "lg", id, button: true,
    cls: `${id === selected ? "sel" : ""} ${callPick.includes(id) ? "picked" : ""} ${id === drawn && isNew ? "new" : ""}`,
  })).join("");
  el.classList.toggle("manual", !prefs.autoSort);
  // not `disabled`: with Autosort off you can rearrange tiles while others play
  el.querySelectorAll(".tile").forEach((b) => { b.setAttribute("aria-disabled", String(!live && !picking)); b.setAttribute("aria-pressed", String(b.dataset.id == selected)); });
}

const seenInPlay = new Set();
const arrive = (key) => { key = `${state.handNo}:${key}`; return seenInPlay.has(key) ? "" : (seenInPlay.add(key), "arrive"); };

function renderBar() {
  const bar = $("bar");
  let say = "", play = "";
  const btns = [];
  if (myTurn()) {
    say = state.afterClaim ? "Now discard a tile." : selected !== null ? "Press Discard, or tap the tile again to put it back." : "Your turn. Tap a tile to pick your discard.";
    if (selected !== null) {
      // the tile you picked shows in the tile-in-play spot, ready to go (tap it, or Discard)
      const k = kindOf(selected);
      play = `<button type="button" class="inplay-pick" data-act="discard" aria-label="Discard ${tileName(k)}">${tileHtml(k, { size: "lg", title: false, cls: arrive(`s${selected}`) })}</button>`;
      btns.push(`<button type="button" class="btn" data-act="discard">Discard</button>`);
    }
    const o = G.actOptions(state, 0);
    if (o.tsumo && o.tsumo.legal) btns.unshift(`<button type="button" class="btn red" data-act="mahjong">Mahjong</button>`);
  } else if (G.claimPendingFor(state, 0)) {
    const ld = state.lastDiscard;
    const k = kindOf(ld.id);
    const who = state.players[ld.from].name;
    const o = state.claim.options[0];
    say = `<b>${who}</b> ${ld.robbing ? `is adding <b>${tileName(k)}</b> to a kong` : `discarded <b>${tileName(k)}</b>`}.${ld.robbing ? "" : `<span class="say-more"> Continue or add tiles to call it.</span>`}`;
    // the set you're forming: the discard plus every tile you've lifted, in order (tap one of yours to drop it)
    const set = [{ k, id: null }, ...callPick.map((id) => ({ k: kindOf(id), id }))].sort((a, b) => a.k - b.k || (a.id === null ? -1 : 1));
    play = set.map((t) => t.id === null
      ? tileHtml(t.k, { size: "lg", cls: arrive(`d${ld.id}`) })
      : `<button type="button" class="inplay-pick" data-unpick="${t.id}" aria-label="Put back ${tileName(t.k)}">${tileHtml(t.k, { size: "lg", title: false, cls: `mine ${arrive(`m${ld.id}-${t.id}`)}` })}</button>`).join("");
    if (o.win) btns.push(`<button type="button" class="btn red" data-mahjong>Mahjong</button>`);
    // one button: Continue, which becomes Call once you've lifted tiles from your hand
    btns.push(callPick.length
      ? `<button type="button" class="btn" data-call>Call</button>`
      : `<button type="button" class="btn" data-claim="pass">Continue</button>`);
  } else if (state.phase === "claim") {
    const ld = state.lastDiscard;
    // your own discard shows exactly like anyone else's: the prompt and the tile in play
    const k = kindOf(ld.id);
    const who = ld.from === 0 ? "You" : state.players[ld.from].name;
    say = `<b>${who}</b> ${ld.robbing ? `${ld.from === 0 ? "are" : "is"} adding <b>${tileName(k)}</b> to a kong` : `discarded <b>${tileName(k)}</b>`}.`;
    play = tileHtml(k, { size: "lg", cls: arrive(`d${ld.id}`) });
  } else if (state.phase !== "over") {
    const p = state.current;
    say = p === 0 ? "Drawing…" : `${state.players[p].name}'s turn`;
  }
  const why = nudge && nudge.key === nudgeKey();
  bar.innerHTML = `<div class="act-left">
      <div class="say ${why ? "nudge" : ""}" ${why ? 'role="status"' : ""}>${why ? nudge.html : say}</div>
      <div class="inplay">${play}</div>
    </div>
    <div class="act-right">${btns.join("")}</div>`;
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
let confirmNew = false;     // in-page "start a new game?" card (native confirm() is blocked in some browsers)

function renderModal() {
  const m = $("modal");
  const card = $("modalCard");
  if (confirmNew) {
    m.hidden = false;
    card.innerHTML = `<h2>Start a new game?</h2><p class="lede">Scores go back to zero and this hand is lost.</p>
      <div class="btns"><button type="button" class="btn light" data-new-cancel>Keep playing</button><button type="button" class="btn" data-new-ok>New game</button></div>`;
    return;
  }
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
  const scores = state.players.map((pl, i) => `<div class="score-cell"><b>${pl.name}</b>${prefs.showScores ? `<span>${pl.score}</span>` : ""}
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
  if (dragJustEnded) return;
  if (b && G.claimPendingFor(state, 0) && !state.lastDiscard.robbing) {
    const id = +b.dataset.id;
    callPick = callPick.includes(id) ? callPick.filter((x) => x !== id) : callPick.length < 3 ? [...callPick, id] : callPick;
    nudge = null;
    return render();
  }
  if (!b || !myTurn()) return;
  const id = +b.dataset.id;
  selected = selected === id ? null : id;
  render();
});

$("bar").addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (a && myTurn()) {
    if (a.dataset.act === "discard" && selected !== null) act({ type: "discard", id: selected });
    if (a.dataset.act === "mahjong") mahjongOnTurn();
    return;
  }
  if (!G.claimPendingFor(state, 0)) return;
  const un = e.target.closest("[data-unpick]");
  if (un) { callPick = callPick.filter((id) => id !== +un.dataset.unpick); nudge = null; return render(); }
  if (e.target.closest("[data-call]")) return callPicked();
  if (e.target.closest("[data-mahjong]")) return mahjongOnDiscard();
  if (e.target.closest("[data-claim=pass]")) return claim({ type: "pass" });
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
  if (confirmNew) {
    if (e.target.closest("[data-new-ok]")) return newGame();
    if (e.target.closest("[data-new-cancel]") || e.target === $("modal")) { confirmNew = false; render(); }
    return;
  }
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

$("settingsBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleSettings(); });
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

document.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => {
  prefs.difficulty = b.dataset.diff;
  savePrefs();
  render();
}));
$("claimedBtn").addEventListener("click", () => {
  prefs.showClaimed = !prefs.showClaimed;
  savePrefs();
  render();
});
$("scoresBtn").addEventListener("click", () => {
  prefs.showScores = !prefs.showScores;
  savePrefs();
  render();
});
$("guideBtn").addEventListener("click", () => { toggleSettings(false); guideOpen = true; render(); });
$("newBtn").addEventListener("click", () => { confirmNew = true; render(); });
function newGame() {
  confirmNew = false;
  guideOpen = false;
  nudge = null;
  state = G.createGame();
  notes = [];
  selected = null;
  closePane();
  update();
}

document.addEventListener("keydown", (e) => {
  if (e.key === " " && !e.repeat && G.claimPendingFor(state, 0) && !guideOpen && !confirmNew && !e.target.closest?.("input, textarea, .settings")) {
    e.preventDefault();
    if (callPick.length) callPicked(); else claim({ type: "pass" });
    return;
  }
  if (e.key === "Escape") {
    if (!$("settings").hidden) { toggleSettings(false); $("settingsBtn").focus(); }
    else if (confirmNew) { confirmNew = false; render(); }
    else if (guideOpen) { guideOpen = false; render(); }
    else if (pane.open) closePane();
  }
});

if (TEST) window.__mc = { tick, get state() { return state; }, get notes() { return notes; } };

update();
