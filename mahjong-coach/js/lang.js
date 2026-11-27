// Mandarin or Cantonese (a setting; Cantonese by default). It changes two things:
//  - the Chinese characters: simplified for Mandarin (东 发 兰 杠), traditional for Cantonese (東 發 蘭 槓)
//  - how the calls are spelled in the English text: Mandarin pinyin with its tone marks (pèng, gàng, chī) or
//    the Cantonese-style spellings (pung, kong, chow)
// The game's text is written with "peng", "kong" and "chow"; localize() swaps those words wherever they
// show on screen.

let lang = "cantonese";
export const getLang = () => lang;
export function setLang(l) { lang = l === "mandarin" ? "mandarin" : "cantonese"; }

const SIMPLIFIED = { "東": "东", "發": "发", "蘭": "兰", "槓": "杠" };
/* A Chinese string in this language's script (the source is written in traditional characters). */
export function zh(s) {
  return lang === "cantonese" ? s : s.replace(/[東發蘭槓]/g, (c) => SIMPLIFIED[c]);
}

const TERMS = {
  mandarin: { peng: "pèng", kong: "gàng", chow: "chī" },
  cantonese: { peng: "pung", kong: "kong", chow: "chow" },
};
/* The call's name in this language ("peng", "kong" or "chow" in), capitalised if asked. */
export function term(t, cap = false) {
  const w = TERMS[lang][t];
  return cap ? w[0].toUpperCase() + w.slice(1) : w;
}
/* The character for each call: 碰 peng, 杠/槓 kong, 吃 chow. */
export const callChar = (t) => zh({ peng: "碰", kong: "槓", chow: "吃" }[t]);

/* Swap "peng" / "kong" / "chow" (any case) for this language's spelling in every text node under root. */
const WORD = /(?<!Hong )\b(peng|kong|chow)\b/gi;  // (never the "Kong" in Hong Kong)
export function localize(root) {
  if (!root) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!WORD.test(n.nodeValue) || n.parentElement?.closest("[data-keep-terms]")) continue;  // (the Language setting names both)
    WORD.lastIndex = 0;
    const v = n.nodeValue.replace(WORD, (m) => term(m.toLowerCase(), m[0] === m[0].toUpperCase()));
    if (v !== n.nodeValue) n.nodeValue = v;  // only when it changes: an unchanged write would set off the watcher again
  }
  WORD.lastIndex = 0;
}
