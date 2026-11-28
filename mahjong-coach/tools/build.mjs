// Build the Coach copy page: the patterns found by harvest.mjs, the site's stylesheet, the page's own CSS and JS.
import { readFileSync, writeFileSync } from "node:fs";
const here = (f) => new URL(f, import.meta.url);
const site = process.argv[2];
const list = JSON.parse(readFileSync(here("./patterns.json"), "utf8"));
const HANDS = +process.argv[3];
const META = {
  "claim-none": ["Can't take the thrown tile", "You don't have the tiles to make a set with it."],
  "claim-run-order": ["Runs only from the player before you", "You could make a run with it, but it came from the wrong player."],
  "claim-take": ["Take it: a peng or chow", "Taking the tile gets you closer to winning."],
  "claim-pass": ["Let it go: it won't help", "Taking the tile wouldn't get you any closer."],
  "claim-take-win": ["Take it and win", "The thrown tile finishes your hand."],
  "turn-lone-honor": ["Throw a single wind or dragon", "The best throw is a wind or dragon you only have one of."],
  "turn-lone-terminal": ["Throw a lone 1 or 9", "The best throw is a 1 or 9 with nothing next to it."],
  "turn-lone": ["Throw a tile with nothing nearby", "The best throw is a middle number on its own."],
  "turn-partial": ["Throw half of a possible run", "The best throw is next to another tile but unlikely to finish."],
  "turn-spare-run": ["Throw a spare from a run", "One copy is already used in a run, so the other is spare."],
  "turn-extra-pair": ["Break up an extra pair", "You have more pairs than a winning hand needs."],
  "turn-tie-same": ["Equally good throws, same reason", "Several tiles are just as good, for the same reason."],
  "turn-tie-diff": ["Equally good throws, different reasons", "Several tiles are just as good, each for its own reason."],
  "turn-win": ["You can win", "Your hand is complete on your turn."],
  "review-discard": ["A better tile to throw", "You threw a tile the coach wouldn't have."],
  "review-both-lone": ["Better throw: both tiles were on their own", "Both tiles were single, but one had more future."],
  "review-both-pairs": ["Better throw: both tiles were pairs", "You broke up the wrong one of two pairs."],
  "review-defense": ["A safer tile to throw", "Someone looked close to winning and you threw a risky tile."],
  "review-let-go": ["You took it, but letting it go was better", "You claimed a tile that didn't get you closer."],
  "review-should-claim": ["You let it go, but taking it would have helped", "You passed on a tile that would have got you closer."],
  "review-missed-win": ["You missed a win", "Your hand could have won and you didn't take it."],
  "summary-lesson": ["End of hand, with one thing to work on", "The recap when the coach has a lesson for next time."],
  "summary-praise": ["End of hand, every choice matched", "The recap when every choice was the coach's choice too."],
  "summary-won": ["End of hand, you won", "The recap after you win."],
  "summary-draw": ["End of hand, nobody won", "The recap when the wall runs out before anyone wins."],
};
// pick a readable example: has the footnote picture when it can, and isn't the longest
const pick = (ex) => [...ex].sort((a, b) => (b.includes("foot-shape") - a.includes("foot-shape")) || a.length - b.length)[Math.min(1, ex.length - 1)];
const faces = [], faceIx = new Map();
const squeeze = (html) => html.replace(/<svg viewBox="0 0 60 80" aria-hidden="true">[\s\S]*?<\/svg>/g, (svg) => {
  if (!faceIx.has(svg)) { faceIx.set(svg, faces.length); faces.push(svg.replace("<svg ", `<svg data-face="${faces.length}" `)); }
  return `<svg data-face="${faceIx.get(svg)}"></svg>`;
});
const patterns = list.filter((e) => META[e.key]).map((e) => ({ key: e.key, name: META[e.key][0], about: META[e.key][1], count: e.count, card: squeeze(pick(e.examples)) }));
const missing = list.filter((e) => !META[e.key]).map((e) => e.key);
if (missing.length) console.log("no label:", missing);
// the site's stylesheet, scoped to the card: :root becomes the shadow host
const css = readFileSync(`${site}/css/style.css`, "utf8").replace(/:root\b/g, ":host");
const DATA = { hands: HANDS, patterns, faces, css };
const STATE = { version: 0, savedAt: null, edits: {} };
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
const RESET = ":root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}";
const html = `<title>Coach Copy</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link id="cc-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap">
<style id="cc-style">${readFileSync(here("./page.css"), "utf8")}</style>
<div id="app"></div>
<script type="application/json" id="cc-data">${json(DATA)}</script>
<script type="application/json" id="cc-state">${json(STATE)}</script>
<script type="text/plain" id="cc-reset">${RESET}</script>
<script id="cc-app">${readFileSync(here("./app.js"), "utf8")}</script>
`;
writeFileSync(here("./coach-copy.html"), html);
console.log(patterns.length, "patterns,", faces.length, "faces,", Math.round(html.length / 1024), "KB");
