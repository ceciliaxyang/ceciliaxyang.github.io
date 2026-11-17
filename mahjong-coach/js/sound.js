// Mahjong tile sounds, synthesised with the Web Audio API (no audio files): a clack is a very short burst of
// filtered noise (the knock) plus a quick high ping (the tile's ring), with a little randomness so no two match.

let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = on; }

// Phones only let a page start sound during a tap, and the first clack plays later (mid-animation). So the
// audio is switched on at the first tap anywhere, with a silent blip. On iPhone the page also asks to play
// like media ("playback") so the clatter isn't muted by the ring/silent switch; the in-game Sound switch
// is the way to turn it off.
function unlock() {
  if (!enabled) return;
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== "running") ctx.resume();
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = b; src.connect(ctx.destination); src.start(0);
  } catch { /* no audio on this device */ }
  if (ctx && ctx.state === "running") ["pointerdown", "touchend", "keydown"].forEach((e) => removeEventListener(e, unlock, true));
}
["pointerdown", "touchend", "keydown"].forEach((e) => addEventListener(e, unlock, true));

function audio() {
  if (!enabled) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}

let noise = null;
function noiseBuffer(a) {
  if (noise) return noise;
  noise = a.createBuffer(1, Math.floor(a.sampleRate * 0.05), a.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  return noise;
}

/* One tile knocking another. `at` = seconds from now, `vol` 0–1. */
export function clack(at = 0, vol = 0.5) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const out = a.createGain();
  out.gain.value = vol * 0.35;
  out.connect(a.destination);

  const knock = a.createBufferSource();
  knock.buffer = noiseBuffer(a);
  knock.playbackRate.value = 0.8 + Math.random() * 0.5;
  const band = a.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2200 + Math.random() * 1600;
  band.Q.value = 3;
  knock.connect(band).connect(out);
  knock.start(t);

  const ping = a.createOscillator();
  ping.type = "triangle";
  ping.frequency.value = 2600 + Math.random() * 1400;
  const pg = a.createGain();
  pg.gain.setValueAtTime(0.25, t);
  pg.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  ping.connect(pg).connect(out);
  ping.start(t);
  ping.stop(t + 0.05);
}

/* The rattle of many tiles being mixed: `count` clacks spread over `seconds`, louder in the middle. */
export function shuffleRattle(seconds = 1, count = 40) {
  for (let i = 0; i < count; i++) {
    const p = Math.random();
    clack(p * seconds, 0.25 + Math.sin(p * Math.PI) * 0.45 * Math.random());
  }
}
