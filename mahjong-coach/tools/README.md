# Coach Copy tools

Scripts behind the Coach Copy page (a private claude.ai artifact): it shows the coach's most common advice
cards as the live game draws them, beside an editable copy that saves new versions of the page.
These files aren't used by the game.

Run from this folder with Node 20+ (no install needed; Python 3 for `diff.py`).

| Step | Command | What it does |
| --- | --- | --- |
| 1 | `node harvest.mjs .. 800` | Plays 800 simulated hands with the real engine and coach (`../js`), groups every coach card into its advice pattern, and writes `patterns.json` with counts and examples. |
| 2 | `node build.mjs .. 800` | Builds a fresh `coach-copy.html` from `patterns.json`, the site's `../css/style.css`, `page.css` and `app.js`. |
| 3 | `node patch-cards.mjs <saved-page.html> <out.html> <key> …` | Updates the example cards for the given pattern keys on an existing page (e.g. one downloaded from the artifact), keeping saved edits and notes. |
| 4 | `python3 diff.py <saved-page.html>` | Lists each saved edit on the page as a text diff against the current card, plus notes: the starting point for turning edits into coach rules in `../js/coach.js`. |

- Pattern keys (`claim-none`, `turn-lone-honor`, `review-discard`, `summary-draw`, …) come from the `RULES` list in `harvest.mjs`; names and descriptions for new pages are in `META` in `build.mjs`.
- When the coach's wording changes, update the matching `RULES` pattern so cards are still grouped; `harvest.mjs` prints any card that matches no pattern as `unmatched`.
- `app.js` and `page.css` are the page's own script and styles; the page republishes itself with the edits stored inside it.
- `patterns.json` and `coach-copy.html` are generated and not committed.
