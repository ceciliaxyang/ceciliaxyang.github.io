// Replace or add example cards on the live page from patterns.json, leaving saved edits alone.
import { readFileSync, writeFileSync } from "node:fs";
const [live, out, ...keys] = process.argv.slice(2);
let html = readFileSync(live, "utf8");
const m = html.match(/(<script type="application\/json" id="cc-data">)([\s\S]*?)(<\/script>)/);
const DATA = JSON.parse(m[2]);
const fresh = JSON.parse(readFileSync(new URL("./patterns.json", import.meta.url), "utf8"));
const META = { "summary-draw": ["End of hand, nobody won", "The recap when the wall runs out before anyone wins."] };
const bare = (svg) => svg.replace(/ data-face="\d+"/, "");
const ix = new Map(DATA.faces.map((f, i) => [bare(f), i]));
const squeeze = (h) => h.replace(/<svg viewBox="0 0 60 80" aria-hidden="true">[\s\S]*?<\/svg>/g, (svg) => {
  if (!ix.has(svg)) { ix.set(svg, DATA.faces.length); DATA.faces.push(svg.replace("<svg ", `<svg data-face="${DATA.faces.length}" `)); }
  return `<svg data-face="${ix.get(svg)}"></svg>`;
});
for (const key of keys) {
  const f = fresh.find((e) => e.key === key);
  const ex = [...f.examples].sort((a, b) => (b.includes("pane-foot") - a.includes("pane-foot")) || a.length - b.length)[0];
  let p = DATA.patterns.find((x) => x.key === key);
  if (!p) {
    p = { key, name: META[key][0], about: META[key][1], count: f.count };
    const at = DATA.patterns.findLastIndex((x) => x.key.startsWith(key.split("-")[0]));
    DATA.patterns.splice(at + 1, 0, p);
  }
  p.card = squeeze(ex);
  console.log("set", key);
}
html = html.replace(m[0], () => m[1] + JSON.stringify(DATA).replace(/</g, "\\u003c") + m[3]);
writeFileSync(out, html);
